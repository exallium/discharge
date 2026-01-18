/**
 * Claude Code Runner Plugin
 *
 * Official runner that executes Claude Code CLI in Docker containers.
 * This is the default, recommended runner for the system.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import { rm, readFile, writeFile, mkdir, chmod } from 'fs/promises';
import { join } from 'path';
import {
  RunnerPlugin,
  RunOptions,
  RunResult,
  AnalysisResult,
  ConversationRunOptions,
} from '../../base';
import { Tool } from '../../../triggers/base';
import type { RunnerConversationResult, RunnerAction, PlanFile, RunnerErrorType } from '../../../types/conversation';
import {
  buildConversationSystemPrompt,
  formatConversationHistory,
  buildPlanCreationPrompt,
  buildPlanIterationPrompt,
  buildExecutionPrompt,
} from '../../../conversation/prompts';
import {
  BugFixConfig,
  AiBugsConfig,
  CategoryConfig,
  findMatchingCategory,
  validateConfig,
} from '../../bug-config';
import { buildCategoryPrompt, getMatchedCategoryName } from '../../prompts';
import { getErrorMessage, isExecError } from '../../../types/errors';
import { getGitHubToken } from '../../../vcs';
import { getSecret } from '../../../secrets';
import {
  createWorktree,
  removeWorktree,
  resolveSecondaryRepos,
  cloneSecondaryRepos,
  cleanupSecondaryRepos,
} from '../../workspace';

const execAsync = promisify(exec);

/**
 * Whether to use git worktrees for faster job execution
 * Enable with USE_GIT_WORKSPACES=true
 */
const USE_GIT_WORKSPACES = process.env.USE_GIT_WORKSPACES === 'true';

/**
 * Whether to mount Docker socket into agent containers
 * Enables tools like Supabase CLI that need to run containers
 * Enable with ENABLE_DOCKER_IN_AGENT=true
 */
const ENABLE_DOCKER_IN_AGENT = process.env.ENABLE_DOCKER_IN_AGENT === 'true';

/**
 * Docker socket path (defaults to standard location)
 */
const DOCKER_SOCKET_PATH = process.env.DOCKER_SOCKET_PATH || '/var/run/docker.sock';

/**
 * Error patterns for classification
 */
const ERROR_PATTERNS = {
  authExpired: [
    /OAuth token has expired/i,
    /authentication_error/i,
    /Please run \/login/i,
    /401.*authentication/i,
    /invalid.*token/i,
    /token.*expired/i,
  ],
  rateLimited: [
    /rate.?limit/i,
    /too many requests/i,
    /429/,
  ],
  invalidConfig: [
    /configuration error/i,
    /invalid config/i,
    /missing required/i,
  ],
};

/**
 * Classify an error based on the error message
 */
function classifyError(errorMessage: string): { type: RunnerErrorType; requiresAdmin: boolean } {
  // Check for auth/OAuth errors - these require admin intervention
  for (const pattern of ERROR_PATTERNS.authExpired) {
    if (pattern.test(errorMessage)) {
      return { type: 'auth_expired', requiresAdmin: true };
    }
  }

  // Check for rate limiting
  for (const pattern of ERROR_PATTERNS.rateLimited) {
    if (pattern.test(errorMessage)) {
      return { type: 'rate_limited', requiresAdmin: false };
    }
  }

  // Check for config errors
  for (const pattern of ERROR_PATTERNS.invalidConfig) {
    if (pattern.test(errorMessage)) {
      return { type: 'invalid_config', requiresAdmin: true };
    }
  }

  // Default to unknown
  return { type: 'unknown', requiresAdmin: false };
}

/**
 * Format an error message for display to users
 */
function formatUserFacingError(
  errorMessage: string,
  errorType: RunnerErrorType,
  requiresAdmin: boolean
): string {
  const prefix = requiresAdmin
    ? '⚠️ **Admin Intervention Required**\n\n'
    : '❌ **Error**\n\n';

  let explanation = '';
  let action = '';

  switch (errorType) {
    case 'auth_expired':
      explanation = 'The Claude API authentication token has expired.';
      action = 'An administrator needs to re-authenticate by running `claude auth login` on the server.';
      break;
    case 'rate_limited':
      explanation = 'The API rate limit has been reached.';
      action = 'This job will be automatically retried. If the problem persists, please contact an administrator.';
      break;
    case 'invalid_config':
      explanation = 'There is a configuration error.';
      action = 'An administrator needs to check the system configuration.';
      break;
    default:
      explanation = 'An unexpected error occurred while processing your request.';
      action = 'If this problem persists, please contact an administrator.';
  }

  return `${prefix}${explanation}\n\n**What to do:** ${action}\n\n<details>\n<summary>Technical Details</summary>\n\n\`\`\`\n${errorMessage.slice(0, 1000)}\n\`\`\`\n</details>`;
}

/**
 * Prepare a writable .claude directory for the container
 * Creates the config structure and sets up the onboarding flag for CLAUDE_CODE_OAUTH_TOKEN auth
 */
async function prepareClaudeConfig(workspacePath: string): Promise<string> {
  const claudeConfigPath = join(workspacePath, '.claude-config');

  // Create the config directory
  await mkdir(claudeConfigPath, { recursive: true });

  // Create .claude.json with hasCompletedOnboarding flag
  // This is required for CLAUDE_CODE_OAUTH_TOKEN to work without interactive prompts
  const claudeJsonPath = join(claudeConfigPath, '.claude.json');
  await writeFile(claudeJsonPath, JSON.stringify({ hasCompletedOnboarding: true }, null, 2));

  // Create necessary subdirectories that Claude Code expects to write to
  await mkdir(join(claudeConfigPath, 'projects'), { recursive: true });
  await mkdir(join(claudeConfigPath, 'debug'), { recursive: true });
  await mkdir(join(claudeConfigPath, 'statsig'), { recursive: true });

  return claudeConfigPath;
}

/**
 * Inject authentication token into git URL for cloning
 */
async function getAuthenticatedRepoUrl(repoUrl: string): Promise<string> {
  // Only modify HTTPS GitHub URLs
  if (!repoUrl.startsWith('https://github.com/')) {
    return repoUrl;
  }

  // Extract owner/repo from URL (e.g., https://github.com/owner/repo.git -> owner/repo)
  const match = repoUrl.match(/github\.com\/([^/]+\/[^/.]+)/);
  if (!match) {
    return repoUrl;
  }
  const repoFullName = match[1];

  const token = await getGitHubToken(repoFullName);
  if (!token) {
    return repoUrl;
  }

  // Convert https://github.com/owner/repo.git to https://x-access-token:TOKEN@github.com/owner/repo.git
  return repoUrl.replace('https://github.com/', `https://x-access-token:${token}@github.com/`);
}

/**
 * Claude Code Runner - Docker-based execution
 */
export class ClaudeCodeRunner implements RunnerPlugin {
  id = 'claude-code';
  type = 'claude-code';
  name = 'Claude Code';

  // Conversation support
  supportsConversation = true;

  /**
   * Get the secrets required by this runner
   */
  getRequiredSecrets() {
    return [
      {
        id: 'claude_oauth_token',
        label: 'Claude OAuth Token',
        description: 'OAuth token for Claude Code CLI. Run `claude setup-token` locally to generate.',
        required: true,
        plugin: 'claude',
        key: 'oauth_token',
      },
    ];
  }

  /**
   * Execute Claude Code in a Docker container
   */
  async run(options: RunOptions): Promise<RunResult> {
    const jobId = randomUUID();
    const timeout = options.timeoutMs || 600000; // 10 minutes default

    // Track whether we're using worktrees (for cleanup logic)
    const useWorktrees = USE_GIT_WORKSPACES && options.projectId;
    let workspacePath = '';
    let fixBranch = '';

    // Track matched category for infrastructure cleanup
    let matchedCategory: CategoryConfig | undefined;

    // Track secondary repos for cleanup
    let secondaryRepoPaths = new Map<string, string>();

    console.log(`[ClaudeCode:${jobId}] Starting execution`, {
      repo: options.repoUrl,
      branch: options.branch,
      labels: options.eventLabels,
      useWorktrees,
    });

    try {
      if (useWorktrees) {
        // Use workspace manager for efficient worktree-based execution
        console.log(`[ClaudeCode:${jobId}] Creating worktree...`);
        workspacePath = await createWorktree(
          options.projectId!,
          jobId,
          options.branch,
          options.repoUrl
        );
        fixBranch = `fix/auto-${jobId.slice(0, 8)}`;
        console.log(`[ClaudeCode:${jobId}] Worktree created at ${workspacePath}`);
      } else {
        // Traditional clone approach
        const worktreeDir = process.env.WORKTREE_DIR || '/workspaces';
        workspacePath = `${worktreeDir}/${jobId}`;

        console.log(`[ClaudeCode:${jobId}] Cloning repository...`);
        const authUrl = await getAuthenticatedRepoUrl(options.repoUrl);
        await execAsync(
          `git clone --depth 1 -b ${options.branch} ${authUrl} ${workspacePath}`,
          { timeout: 60000 }
        );

        // Create fix branch
        fixBranch = `fix/auto-${jobId.slice(0, 8)}`;
        console.log(`[ClaudeCode:${jobId}] Creating branch ${fixBranch}`);
        await execAsync(`git checkout -b ${fixBranch}`, { cwd: workspacePath });
      }

      // Read .ai-bugs.json if it exists
      // Supports both v1 (categories) and v2 (rules + agents) schemas
      let bugConfig: BugFixConfig | undefined;
      let bugConfigV2: AiBugsConfig | undefined;
      let isV2Config = false;
      try {
        const configPath = join(workspacePath, '.ai-bugs.json');
        const content = await readFile(configPath, 'utf-8');
        const parsed = JSON.parse(content);
        const validation = validateConfig(parsed);
        if (validation.valid) {
          isV2Config = validation.isV2;
          if (isV2Config) {
            bugConfigV2 = validation.config as AiBugsConfig;
            console.log(`[ClaudeCode:${jobId}] Loaded .ai-bugs.json (v2 schema)`);
          } else {
            bugConfig = validation.config as BugFixConfig;
            console.log(`[ClaudeCode:${jobId}] Loaded .ai-bugs.json (v1 schema)`);
          }
        } else {
          console.warn(
            `[ClaudeCode:${jobId}] Invalid .ai-bugs.json: ${validation.error}`
          );
        }
      } catch {
        console.log(`[ClaudeCode:${jobId}] No .ai-bugs.json found, using defaults`);
      }

      // Clone secondary repositories if configured
      // Handle both v1 and v2 formats
      const secondaryRepos = isV2Config
        ? bugConfigV2?.config?.secondaryRepos || []
        : bugConfig?.secondaryRepos || [];

      if (secondaryRepos.length > 0) {
        console.log(`[ClaudeCode:${jobId}] Cloning ${secondaryRepos.length} secondary repos`);
        const secondaryRepoInfos = resolveSecondaryRepos(secondaryRepos, 'github');
        secondaryRepoPaths = await cloneSecondaryRepos(workspacePath, secondaryRepoInfos);
        console.log(`[ClaudeCode:${jobId}] Cloned ${secondaryRepoPaths.size} secondary repos`);
      }

      // Find matching category based on event labels
      const eventLabels = options.eventLabels || [];
      matchedCategory = findMatchingCategory(bugConfig?.categories, eventLabels);
      const categoryName = getMatchedCategoryName(bugConfig, eventLabels);

      if (categoryName) {
        console.log(`[ClaudeCode:${jobId}] Matched category: ${categoryName}`);
      }

      // Spin up infrastructure if this category requires it
      if (matchedCategory?.infrastructure?.setup) {
        const infraTimeout =
          (matchedCategory.infrastructure.timeout || 120) * 1000;
        console.log(
          `[ClaudeCode:${jobId}] Starting infrastructure: ${matchedCategory.infrastructure.setup}`
        );

        await execAsync(matchedCategory.infrastructure.setup, {
          cwd: workspacePath,
          timeout: infraTimeout,
        });

        // Run healthcheck if defined
        if (matchedCategory.infrastructure.healthcheck) {
          console.log(`[ClaudeCode:${jobId}] Running infrastructure healthcheck...`);
          await execAsync(matchedCategory.infrastructure.healthcheck, {
            cwd: workspacePath,
            timeout: 30000,
          });
        }

        console.log(`[ClaudeCode:${jobId}] Infrastructure ready`);
      }

      // Write tools to workspace if provided
      if (options.tools && options.tools.length > 0) {
        await this.writeToolsToWorkspace(workspacePath, options.tools);
      }

      // Get Claude authentication - prefer OAuth token, fall back to API key
      const oauthToken = await getSecret('claude', 'oauth_token', options.projectId, 'CLAUDE_CODE_OAUTH_TOKEN');
      const anthropicApiKey = await getSecret('anthropic', 'api_key', options.projectId, 'ANTHROPIC_API_KEY');

      if (!oauthToken && !anthropicApiKey) {
        throw new Error(
          'No authentication configured. Either:\n' +
          '  1. Set CLAUDE_CODE_OAUTH_TOKEN (run `claude setup-token` locally to generate), or\n' +
          '  2. Set ANTHROPIC_API_KEY as a project secret or environment variable'
        );
      }

      if (oauthToken) {
        console.log(`[ClaudeCode:${jobId}] Using CLAUDE_CODE_OAUTH_TOKEN`);
      } else {
        console.log(`[ClaudeCode:${jobId}] Using ANTHROPIC_API_KEY`);
      }

      // Build environment variables - OAuth token takes precedence
      const envVars: Record<string, string> = {
        ...(oauthToken ? { CLAUDE_CODE_OAUTH_TOKEN: oauthToken } : {}),
        ...(anthropicApiKey && !oauthToken ? { ANTHROPIC_API_KEY: anthropicApiKey } : {}),
        ...options.env,
      };

      const envFlags = Object.entries(envVars)
        .filter(([_, v]) => v) // Only include non-empty values
        .map(([k, v]) => `-e ${k}="${v}"`)
        .join(' ');

      // Add tools directory to PATH if tools were provided
      const pathEnv =
        options.tools && options.tools.length > 0
          ? `-e PATH="/workspace/.claude-tools:$PATH"`
          : '';

      // Extract repo full name from URL for prompt
      const repoMatch = options.repoUrl.match(/github\.com[:/]([^/]+\/[^/.]+)/);
      const mainRepoFullName = repoMatch ? repoMatch[1] : undefined;

      // Enhance prompt with category-specific requirements and secondary repos
      const enhancedPrompt = buildCategoryPrompt(
        options.prompt,
        bugConfig,
        eventLabels,
        mainRepoFullName
      );

      // Write prompt to file (avoids shell argument length limits)
      const promptFile = join(workspacePath, '.claude-prompt.txt');
      await writeFile(promptFile, enhancedPrompt, 'utf-8');

      // Prepare writable .claude config directory
      const claudeConfigPath = await prepareClaudeConfig(workspacePath);

      // Docker socket mount for running containers inside agent (e.g., Supabase)
      const dockerMount = ENABLE_DOCKER_IN_AGENT
        ? `-v ${DOCKER_SOCKET_PATH}:/var/run/docker.sock`
        : '';

      // Build volume mounts for secondary repos (read-only for reference)
      const secondaryMounts = Array.from(secondaryRepoPaths.entries())
        .map(([fullName, localPath]) => {
          const repoName = fullName.split('/')[1];
          return `-v ${localPath}:/workspace-secondary/${repoName}:ro`;
        })
        .join(' ');

      // Run Claude Code (read prompt from file inside container via cat pipe)
      console.log(`[ClaudeCode:${jobId}] Running Claude Code CLI...`);
      const { stdout } = await execAsync(
        `
        docker run --rm \
          --name claude-${jobId.slice(0, 8)} \
          --network ${process.env.DOCKER_NETWORK || 'ai-bug-fixer_internal'} \
          -v ${workspacePath}:/workspace \
          -v ${claudeConfigPath}:/home/agent/.claude \
          ${dockerMount} \
          ${secondaryMounts} \
          ${envFlags} \
          ${pathEnv} \
          --cpus="2" \
          --memory="4g" \
          --pids-limit 100 \
          --entrypoint /bin/sh \
          agent-runner-claude:latest \
          -c 'cat /workspace/.claude-prompt.txt | claude --print --dangerously-skip-permissions --max-turns 30 -p -'
      `,
        { timeout, maxBuffer: 10 * 1024 * 1024 }
      );

      console.log(`[ClaudeCode:${jobId}] Execution completed`);

      // Check for commits
      const { stdout: gitLog } = await execAsync(
        'git log --oneline -1 2>/dev/null || echo "no commits"',
        { cwd: workspacePath }
      );
      const hasCommit =
        !gitLog.includes('no commits') && gitLog.trim().length > 0;

      if (hasCommit) {
        console.log(`[ClaudeCode:${jobId}] Found commit: ${gitLog.trim()}`);
      }

      // Try to read analysis.json
      let analysis: AnalysisResult | undefined;
      try {
        const analysisPath = join(workspacePath, '.claude', 'analysis.json');
        const content = await readFile(analysisPath, 'utf-8');
        analysis = JSON.parse(content);
        if (analysis) {
          console.log(`[ClaudeCode:${jobId}] Analysis:`, {
            canAutoFix: analysis.canAutoFix,
            confidence: analysis.confidence,
          });
        }
      } catch {
        console.log(`[ClaudeCode:${jobId}] No analysis.json found`);
      }

      // Push branch if there's a commit
      if (hasCommit) {
        console.log(`[ClaudeCode:${jobId}] Pushing branch ${fixBranch}...`);
        await execAsync(`git push origin ${fixBranch}`, { cwd: workspacePath });
      }

      return {
        success: true,
        jobId,
        output: stdout,
        hasCommit,
        analysis,
        branchName: hasCommit ? fixBranch : undefined,
      };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      console.error(`[ClaudeCode:${jobId}] Execution failed:`, errorMessage);

      return {
        success: false,
        jobId,
        output: isExecError(error) ? (error.stdout || errorMessage) : errorMessage,
        hasCommit: false,
        error: errorMessage,
      };
    } finally {
      // Teardown infrastructure if it was started
      if (matchedCategory?.infrastructure?.teardown) {
        console.log(
          `[ClaudeCode:${jobId}] Tearing down infrastructure: ${matchedCategory.infrastructure.teardown}`
        );
        await execAsync(matchedCategory.infrastructure.teardown, {
          cwd: workspacePath,
          timeout: 30000,
        }).catch((err) => {
          console.error(
            `[ClaudeCode:${jobId}] Infrastructure teardown failed:`,
            getErrorMessage(err)
          );
        });
      }

      // Cleanup secondary repositories
      if (secondaryRepoPaths.size > 0) {
        console.log(`[ClaudeCode:${jobId}] Cleaning up secondary repos...`);
        await cleanupSecondaryRepos(workspacePath, secondaryRepoPaths).catch((err) => {
          console.error(
            `[ClaudeCode:${jobId}] Failed to cleanup secondary repos:`,
            getErrorMessage(err)
          );
        });
      }

      // Cleanup workspace
      console.log(`[ClaudeCode:${jobId}] Cleaning up workspace...`);
      if (useWorktrees && options.projectId) {
        // Use workspace manager for worktree cleanup
        await removeWorktree(options.projectId, jobId).catch((err) => {
          console.error(
            `[ClaudeCode:${jobId}] Failed to remove worktree:`,
            getErrorMessage(err)
          );
        });
      } else {
        // Traditional cleanup
        await rm(workspacePath, { recursive: true, force: true }).catch((err) => {
          console.error(
            `[ClaudeCode:${jobId}] Failed to cleanup workspace:`,
            getErrorMessage(err)
          );
        });
      }
    }
  }

  /**
   * Check if Claude Code runner is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      // Check Docker is running
      await execAsync('docker info', { timeout: 5000 });

      // Check agent-runner image exists
      const { stdout } = await execAsync(
        'docker images -q agent-runner-claude:latest'
      );
      return stdout.trim().length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Validate Claude Code runner configuration
   */
  async validate(): Promise<{ valid: boolean; error?: string }> {
    try {
      // Check Docker
      await execAsync('docker info', { timeout: 5000 });
    } catch {
      return {
        valid: false,
        error: 'Docker is not available. Start Docker daemon.',
      };
    }

    try {
      // Check image
      const { stdout } = await execAsync(
        'docker images -q agent-runner-claude:latest'
      );
      if (stdout.trim().length === 0) {
        return {
          valid: false,
          error:
            'agent-runner-claude:latest image not found. Run: docker compose --profile build-only build',
        };
      }
    } catch {
      return {
        valid: false,
        error: 'Failed to check Docker images',
      };
    }

    return { valid: true };
  }

  /**
   * Write tools to workspace
   */
  private async writeToolsToWorkspace(
    workspacePath: string,
    tools: Tool[]
  ): Promise<void> {
    const toolsDir = join(workspacePath, '.claude-tools');
    await mkdir(toolsDir, { recursive: true });

    for (const tool of tools) {
      const toolPath = join(toolsDir, tool.name);

      // Ensure script has proper shebang
      const script = tool.script.startsWith('#!')
        ? tool.script
        : `#!/bin/bash\n${tool.script}`;

      await writeFile(toolPath, script, { mode: 0o755 });
      await chmod(toolPath, 0o755); // Ensure executable
    }

    console.log(`[ClaudeCode] Generated ${tools.length} tools in ${toolsDir}`);
  }

  // ========================================
  // Conversation Mode
  // ========================================

  /**
   * Execute Claude Code in conversation mode
   */
  async runConversation(
    options: ConversationRunOptions
  ): Promise<RunnerConversationResult> {
    const jobId = randomUUID();
    const timeout = options.timeoutMs || 600000;

    // Determine workspace approach
    const isPreConfiguredWorkspace = !!options.workspacePath;
    const useWorktrees = !isPreConfiguredWorkspace && USE_GIT_WORKSPACES && options.projectId;
    let workspacePath = '';
    let fixBranch = '';

    // Check if we're updating an existing PR (should use existing branch)
    const isUpdatingExistingPR = !!options.existingPrBranch;

    console.log(`[ClaudeCode:${jobId}] Starting conversation mode execution`, {
      repo: options.repoUrl,
      branch: options.branch,
      routeMode: options.routeMode,
      iteration: options.iteration,
      hasExistingPlan: !!options.existingPlan,
      existingPrNumber: options.existingPrNumber,
      existingPrBranch: options.existingPrBranch,
      useWorktrees,
    });

    try {
      if (isPreConfiguredWorkspace) {
        // Use provided workspace
        workspacePath = options.workspacePath!;
        fixBranch = options.existingPrBranch || `fix/conversation-${jobId.slice(0, 8)}`;
      } else if (useWorktrees) {
        // Use workspace manager for efficient worktree-based execution
        console.log(`[ClaudeCode:${jobId}] Creating worktree...`);
        workspacePath = await createWorktree(
          options.projectId!,
          jobId,
          options.existingPrBranch || options.branch, // Use PR branch if updating existing PR
          options.repoUrl
        );
        fixBranch = options.existingPrBranch || `fix/auto-${jobId.slice(0, 8)}`;
        console.log(`[ClaudeCode:${jobId}] Worktree created at ${workspacePath}`);
      } else {
        // Traditional clone approach
        const worktreeDir = process.env.WORKTREE_DIR || '/workspaces';
        workspacePath = `${worktreeDir}/${jobId}`;

        // Clone the appropriate branch
        const cloneBranch = options.existingPrBranch || options.branch;
        console.log(`[ClaudeCode:${jobId}] Cloning repository (branch: ${cloneBranch})...`);
        const authUrl = await getAuthenticatedRepoUrl(options.repoUrl);
        await execAsync(
          `git clone --depth 1 -b ${cloneBranch} ${authUrl} ${workspacePath}`,
          { timeout: 60000 }
        );

        if (isUpdatingExistingPR) {
          // Use existing PR branch - no need to create a new one
          fixBranch = options.existingPrBranch!;
          console.log(`[ClaudeCode:${jobId}] Using existing PR branch: ${fixBranch}`);
        } else {
          // Create new fix branch
          fixBranch = `fix/conversation-${jobId.slice(0, 8)}`;
          console.log(`[ClaudeCode:${jobId}] Creating branch ${fixBranch}`);
          await execAsync(`git checkout -b ${fixBranch}`, { cwd: workspacePath }).catch(() => {
            // Branch might already exist
            console.log(`[ClaudeCode:${jobId}] Branch already exists, continuing...`);
          });
        }
      }

      // Build the conversation prompt
      const conversationPrompt = this.buildConversationPrompt(options);

      // Write prompt to file (avoids shell argument length limits)
      const promptFile = join(workspacePath, '.claude-prompt.txt');
      await writeFile(promptFile, conversationPrompt, 'utf-8');

      // Get Claude authentication - prefer OAuth token, fall back to API key
      const oauthToken = await getSecret('claude', 'oauth_token', options.projectId, 'CLAUDE_CODE_OAUTH_TOKEN');
      const anthropicApiKey = await getSecret('anthropic', 'api_key', options.projectId, 'ANTHROPIC_API_KEY');

      if (!oauthToken && !anthropicApiKey) {
        throw new Error(
          'No authentication configured. Either:\n' +
          '  1. Set CLAUDE_CODE_OAUTH_TOKEN (run `claude setup-token` locally to generate), or\n' +
          '  2. Set ANTHROPIC_API_KEY as a project secret or environment variable'
        );
      }

      if (oauthToken) {
        console.log(`[ClaudeCode:${jobId}] Using CLAUDE_CODE_OAUTH_TOKEN`);
      } else {
        console.log(`[ClaudeCode:${jobId}] Using ANTHROPIC_API_KEY`);
      }

      // Build environment variables - OAuth token takes precedence
      const envVars: Record<string, string> = {
        ...(oauthToken ? { CLAUDE_CODE_OAUTH_TOKEN: oauthToken } : {}),
        ...(anthropicApiKey && !oauthToken ? { ANTHROPIC_API_KEY: anthropicApiKey } : {}),
        ...options.env,
        AI_CONVERSATION_MODE: 'true',
        AI_ROUTE_MODE: options.routeMode,
        AI_ITERATION: String(options.iteration),
      };

      const envFlags = Object.entries(envVars)
        .filter(([_, v]) => v)
        .map(([k, v]) => `-e ${k}="${v}"`)
        .join(' ');

      // Add tools directory to PATH if tools were provided
      const pathEnv =
        options.tools && options.tools.length > 0
          ? `-e PATH="/workspace/.claude-tools:$PATH"`
          : '';

      // Write tools to workspace if provided
      if (options.tools && options.tools.length > 0) {
        await this.writeToolsToWorkspace(workspacePath, options.tools);
      }

      // Prepare writable .claude config directory
      const claudeConfigPath = await prepareClaudeConfig(workspacePath);

      // Docker socket mount for running containers inside agent (e.g., Supabase)
      const dockerMount = ENABLE_DOCKER_IN_AGENT
        ? `-v ${DOCKER_SOCKET_PATH}:/var/run/docker.sock`
        : '';

      // Run Claude Code (read prompt from file inside container via cat pipe)
      console.log(`[ClaudeCode:${jobId}] Running Claude Code CLI in conversation mode...`);
      const { stdout } = await execAsync(
        `
        docker run --rm \
          --name claude-conv-${jobId.slice(0, 8)} \
          --network ${process.env.DOCKER_NETWORK || 'ai-bug-fixer_internal'} \
          -v ${workspacePath}:/workspace \
          -v ${claudeConfigPath}:/home/agent/.claude \
          ${dockerMount} \
          ${envFlags} \
          ${pathEnv} \
          --cpus="2" \
          --memory="4g" \
          --pids-limit 100 \
          --entrypoint /bin/sh \
          agent-runner-claude:latest \
          -c 'cat /workspace/.claude-prompt.txt | claude --print --dangerously-skip-permissions --max-turns 30 -p -'
      `,
        { timeout, maxBuffer: 10 * 1024 * 1024 }
      );

      console.log(`[ClaudeCode:${jobId}] Conversation execution completed`);

      // Parse the conversation result
      const result = await this.parseConversationResult(workspacePath, stdout, options);

      // Check for commits if executing
      if (options.routeMode === 'auto_execute' || (options.existingPlan?.metadata.status === 'approved')) {
        const { stdout: gitLog } = await execAsync(
          'git log --oneline -1 2>/dev/null || echo "no commits"',
          { cwd: workspacePath }
        );
        const hasCommit = !gitLog.includes('no commits') && gitLog.trim().length > 0;

        if (hasCommit) {
          console.log(`[ClaudeCode:${jobId}] Found commit: ${gitLog.trim()}`);
          await execAsync(`git push origin ${fixBranch}`, { cwd: workspacePath });
        }
      }

      return result;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      // Also capture stderr/stdout for exec errors
      let fullError = errorMessage;
      if (isExecError(error)) {
        if (error.stderr) {
          fullError += `\nstderr: ${error.stderr}`;
        }
        if (error.stdout) {
          fullError += `\nstdout: ${error.stdout}`;
        }
      }
      console.error(`[ClaudeCode:${jobId}] Conversation execution failed:`, fullError);

      // Classify the error
      const { type: errorType, requiresAdmin } = classifyError(fullError);
      const userMessage = formatUserFacingError(fullError, errorType, requiresAdmin);

      console.log(`[ClaudeCode:${jobId}] Error classified as: ${errorType}, requiresAdmin: ${requiresAdmin}`);

      return {
        response: `Execution failed: ${errorMessage}`,
        action: { type: 'comment', body: userMessage },
        complete: false,
        errorType,
        requiresAdminIntervention: requiresAdmin,
      };
    } finally {
      // Only cleanup if we created the workspace (not pre-configured)
      if (!isPreConfiguredWorkspace) {
        console.log(`[ClaudeCode:${jobId}] Cleaning up workspace...`);
        if (useWorktrees && options.projectId) {
          // Use workspace manager for worktree cleanup
          await removeWorktree(options.projectId, jobId).catch((err) => {
            console.error(
              `[ClaudeCode:${jobId}] Failed to remove worktree:`,
              getErrorMessage(err)
            );
          });
        } else {
          // Traditional cleanup
          await rm(workspacePath, { recursive: true, force: true }).catch((err) => {
            console.error(
              `[ClaudeCode:${jobId}] Failed to cleanup workspace:`,
              getErrorMessage(err)
            );
          });
        }
      }
    }
  }

  /**
   * Build conversation prompt based on mode and context
   */
  private buildConversationPrompt(options: ConversationRunOptions): string {
    const parts: string[] = [];

    // Extract repo info from URL (basic parsing)
    const repoMatch = options.repoUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
    const repo = repoMatch
      ? { owner: repoMatch[1], name: repoMatch[2] }
      : { owner: 'unknown', name: 'unknown' };

    // Build target info from prompt (basic extraction)
    const target = { type: 'issue', number: options.iteration, title: 'Issue' };

    // Add system prompt
    parts.push(buildConversationSystemPrompt(repo, target, options.routeMode, options.iteration));
    parts.push('');

    // Add conversation history if available
    if (options.conversationHistory && options.conversationHistory.length > 0) {
      parts.push(formatConversationHistory(options.conversationHistory));
      parts.push('');
    }

    // Add existing plan context if available
    if (options.existingPlan) {
      if (options.existingPlan.metadata.status === 'approved') {
        // Execution mode
        parts.push(buildExecutionPrompt(options.existingPlan));
      } else {
        // Plan iteration mode - use original prompt as feedback
        parts.push(buildPlanIterationPrompt(options.existingPlan, options.prompt));
      }
    } else {
      // New conversation - use the original prompt
      parts.push('## New Request');
      parts.push('');
      parts.push(options.prompt);

      // Add plan creation instructions if in plan_review mode
      if (options.routeMode === 'plan_review') {
        parts.push('');
        parts.push(buildPlanCreationPrompt('', options.routeMode));
      }
    }

    // Add output format instructions
    parts.push('');
    parts.push('## Output Instructions');
    parts.push('');
    parts.push('**IMPORTANT:** After completing your analysis, you MUST create the file `.claude/conversation-result.json`.');
    parts.push('First create the `.claude` directory if it does not exist, then write the JSON file.');
    parts.push('');

    if (options.routeMode === 'plan_review' && !options.existingPlan) {
      // Plan creation mode - show complete plan structure
      parts.push('Since you are creating a plan, use this exact structure:');
      parts.push('```json');
      parts.push(JSON.stringify({
        response: "A brief summary of your analysis and proposed plan",
        action: {
          type: "create_plan",
          plan: {
            metadata: {
              issue: options.issueNumber ?? options.iteration,
              status: "draft",
              iteration: 1,
              confidence: 0.7,
              created: new Date().toISOString(),
              updated: new Date().toISOString(),
              author: "claude"
            },
            sections: {
              context: "Your understanding of the problem. What is being requested? What is the current state?",
              approach: "Your high-level strategy. How will you solve this? What technologies/patterns will you use?",
              steps: [
                {
                  title: "Step 1 title",
                  description: "Detailed description of what this step accomplishes",
                  tasks: ["Specific task 1", "Specific task 2"],
                  files: ["path/to/file1.ts", "path/to/file2.ts"],
                  estimatedComplexity: "low"
                }
              ],
              risks: ["Potential risk 1", "Potential risk 2"],
              questions: ["Any clarifying questions for the user"]
            }
          }
        },
        complete: false
      }, null, 2));
      parts.push('```');
      parts.push('');
      parts.push('**Requirements:**');
      parts.push('- `context`: Must describe the problem in 2-4 sentences minimum');
      parts.push('- `approach`: Must describe your solution strategy in 2-4 sentences minimum');
      parts.push('- `steps`: Must have at least one step with title, description, tasks, and files');
      parts.push('- `estimatedComplexity`: Must be one of "trivial", "low", "medium", "high"');
    } else if (options.existingPlan && options.existingPlan.metadata.status !== 'approved') {
      // Plan iteration mode - show update_plan structure
      parts.push('Since you are updating an existing plan based on feedback, use this structure:');
      parts.push('```json');
      parts.push(JSON.stringify({
        response: "Brief summary of changes made to the plan",
        action: {
          type: "update_plan",
          content: "The FULL updated plan in markdown format (see structure below)",
          planVersion: (options.existingPlan.metadata.iteration || 1) + 1
        },
        complete: false
      }, null, 2));
      parts.push('```');
      parts.push('');
      parts.push('**The `content` field must contain the full updated plan in this markdown format:**');
      parts.push('```markdown');
      parts.push('## Context');
      parts.push('[Updated understanding of the problem]');
      parts.push('');
      parts.push('## Approach');
      parts.push('[Updated solution strategy]');
      parts.push('');
      parts.push('## Steps');
      parts.push('### Step 1: [Title]');
      parts.push('**Complexity:** low|medium|high');
      parts.push('**Files:** `file1.ts`, `file2.ts`');
      parts.push('[Description]');
      parts.push('- [ ] Task 1');
      parts.push('- [ ] Task 2');
      parts.push('');
      parts.push('## Risks');
      parts.push('- [Risk 1]');
      parts.push('');
      parts.push('## Questions');
      parts.push('1. [Any remaining questions]');
      parts.push('```');
      parts.push('');
      parts.push('**Important:** Include ALL sections in the content, even if unchanged. The content replaces the entire plan file.');
      parts.push('');
      parts.push('If you only need to acknowledge feedback or ask a question (no plan changes), use:');
      parts.push('```json');
      parts.push('{');
      parts.push('  "response": "Your message",');
      parts.push('  "action": { "type": "comment", "body": "Your message" },');
      parts.push('  "complete": false');
      parts.push('}');
      parts.push('```');
    } else {
      // Other modes (execution, auto_execute) - show general structure
      parts.push('Use this structure for your result:');
      parts.push('```json');
      parts.push('{');
      parts.push('  "response": "Your response message to the user",');
      parts.push('  "action": {');
      parts.push('    "type": "comment",');
      parts.push('    "body": "The message to post as a comment"');
      parts.push('  },');
      parts.push('  "complete": false');
      parts.push('}');
      parts.push('```');
      parts.push('');
      parts.push('Action types: "create_plan", "update_plan", "execute", "comment", "request_info"');
    }

    return parts.join('\n');
  }

  /**
   * Parse conversation result from Claude's output
   */
  private async parseConversationResult(
    workspacePath: string,
    stdout: string,
    options: ConversationRunOptions
  ): Promise<RunnerConversationResult> {
    // Try to read the structured result file
    try {
      const resultPath = join(workspacePath, '.claude', 'conversation-result.json');
      const content = await readFile(resultPath, 'utf-8');
      const result = JSON.parse(content) as RunnerConversationResult;

      console.log('[ClaudeCode] Found conversation-result.json, parsing...');

      // Validate required fields
      if (result.response && result.action) {
        // If action is create_plan, validate and fix the plan structure
        if (result.action.type === 'create_plan' && result.action.plan) {
          // Pass stdout as fallback content for empty sections
          result.action.plan = this.validateAndFixPlan(result.action.plan, options, stdout);
        }
        return result;
      }
    } catch {
      console.log('[ClaudeCode] No conversation-result.json found, parsing from output');
    }

    // Log stdout length for debugging
    console.log(`[ClaudeCode] Parsing from stdout (${stdout.length} chars)`);

    // Fallback: Parse from stdout
    const result = this.parseResultFromOutput(stdout, options);
    return result;
  }

  /**
   * Parse conversation result from stdout when JSON file is not available
   */
  private parseResultFromOutput(
    stdout: string,
    options: ConversationRunOptions
  ): RunnerConversationResult {
    // Default action based on route mode
    let action: RunnerAction;

    if (options.routeMode === 'plan_review' && !options.existingPlan) {
      // Generate a basic plan from the output
      action = {
        type: 'create_plan',
        plan: this.generateBasicPlan(stdout, options),
      };
    } else if (options.routeMode === 'assist_only') {
      action = {
        type: 'comment',
        body: stdout.slice(0, 5000), // Truncate for comment
      };
    } else {
      // Default to comment with the output
      action = {
        type: 'comment',
        body: stdout.slice(0, 5000),
      };
    }

    return {
      response: stdout,
      action,
      complete: options.routeMode === 'auto_execute',
    };
  }

  /**
   * Generate a basic plan structure from output
   */
  private generateBasicPlan(output: string, options: ConversationRunOptions): PlanFile {
    return {
      metadata: {
        issue: options.issueNumber ?? options.iteration,
        status: 'draft',
        iteration: 1,
        confidence: 0.5,
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        author: 'claude',
      },
      sections: {
        context: 'Auto-generated from analysis',
        approach: output.slice(0, 1000),
        steps: [],
        risks: [],
        questions: [],
      },
    };
  }

  /**
   * Validate and fix a plan structure, filling in missing metadata.
   * If sections are empty, uses stdout as fallback content.
   */
  private validateAndFixPlan(
    plan: Partial<PlanFile>,
    options: ConversationRunOptions,
    stdout?: string
  ): PlanFile {
    const now = new Date().toISOString();

    // Ensure metadata exists and has required fields
    const metadata = plan.metadata || {} as Partial<PlanFile['metadata']>;
    const fixedMetadata: PlanFile['metadata'] = {
      issue: metadata.issue ?? options.issueNumber ?? options.iteration,
      status: metadata.status ?? 'draft',
      iteration: metadata.iteration ?? 1,
      confidence: metadata.confidence ?? 0.5,
      created: metadata.created ?? now,
      updated: metadata.updated ?? now,
      author: metadata.author ?? 'claude',
    };

    // Ensure sections exist
    const sections = plan.sections || {} as Partial<PlanFile['sections']>;

    // Check if sections are essentially empty (no real content)
    const hasEmptySections =
      !sections.context?.trim() &&
      !sections.approach?.trim() &&
      (!sections.steps || sections.steps.length === 0);

    // If sections are empty and we have stdout, try to extract content from it
    let fallbackContext = '';
    let fallbackApproach = '';

    if (hasEmptySections && stdout && stdout.trim()) {
      // Use stdout as fallback content
      console.log('[ClaudeCode] Plan has empty sections, using stdout as fallback');

      // Clean up the stdout - remove tool output noise, keep the analysis
      const cleanedOutput = this.cleanStdoutForPlan(stdout);

      if (cleanedOutput.length > 100) {
        // Use the full cleaned output as context, with a note
        fallbackContext = cleanedOutput;
        fallbackApproach = '*(See context above for full analysis - plan sections were not properly structured)*';
      }
    }

    const fixedSections: PlanFile['sections'] = {
      context: sections.context?.trim() || fallbackContext || 'Analysis pending',
      approach: sections.approach?.trim() || fallbackApproach || 'Approach to be determined based on analysis',
      steps: sections.steps ?? [],
      risks: sections.risks ?? [],
      questions: sections.questions ?? [],
    };

    // Log if we filled in fallback content
    if (fallbackContext || fallbackApproach) {
      console.log('[ClaudeCode] Filled plan with fallback content from stdout', {
        contextLength: fixedSections.context.length,
        approachLength: fixedSections.approach.length,
      });
    }

    return {
      metadata: fixedMetadata,
      sections: fixedSections,
    };
  }

  /**
   * Clean stdout to extract meaningful content for plan fallback.
   * Removes tool output noise and keeps the analysis text.
   */
  private cleanStdoutForPlan(stdout: string): string {
    // Split into lines for processing
    const lines = stdout.split('\n');
    const cleanedLines: string[] = [];
    let inCodeBlock = false;
    let skipNextLines = 0;

    for (const line of lines) {
      // Track code blocks
      if (line.trim().startsWith('```')) {
        inCodeBlock = !inCodeBlock;
        // Skip small code blocks (likely tool output)
        if (!inCodeBlock) {
          skipNextLines = 0;
        }
        continue;
      }

      // Skip lines we marked to skip
      if (skipNextLines > 0) {
        skipNextLines--;
        continue;
      }

      // Skip tool output patterns
      if (inCodeBlock) continue;
      if (line.startsWith('Reading file:')) continue;
      if (line.startsWith('Searching for:')) continue;
      if (line.startsWith('Running:')) continue;
      if (line.match(/^\s*\d+[│|]/)) continue; // File line numbers
      if (line.match(/^[─┬┴├┤┼═╔╗╚╝╠╣╦╩╬]+$/)) continue; // Box drawing

      // Keep meaningful content
      const trimmed = line.trim();
      if (trimmed.length > 0) {
        cleanedLines.push(line);
      } else if (cleanedLines.length > 0 && cleanedLines[cleanedLines.length - 1].trim() !== '') {
        // Preserve paragraph breaks
        cleanedLines.push('');
      }
    }

    // Join and truncate to reasonable length (max 4000 chars for plan context)
    let result = cleanedLines.join('\n').trim();
    if (result.length > 4000) {
      // Truncate at a paragraph boundary if possible
      const truncatePoint = result.lastIndexOf('\n\n', 4000);
      if (truncatePoint > 2000) {
        result = result.slice(0, truncatePoint) + '\n\n*(truncated)*';
      } else {
        result = result.slice(0, 4000) + '...\n\n*(truncated)*';
      }
    }

    return result;
  }
}
