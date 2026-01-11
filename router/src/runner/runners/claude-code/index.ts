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
} from '../../base';
import { Tool } from '../../../triggers/base';
import {
  BugFixConfig,
  CategoryConfig,
  findMatchingCategory,
  validateBugConfig,
} from '../../bug-config';
import { buildCategoryPrompt, getMatchedCategoryName } from '../../prompts';
import { getErrorMessage, isExecError } from '../../../types/errors';

const execAsync = promisify(exec);

/**
 * Claude Code Runner - Docker-based execution
 */
export class ClaudeCodeRunner implements RunnerPlugin {
  id = 'claude-code';
  type = 'claude-code';
  name = 'Claude Code';

  /**
   * Execute Claude Code in a Docker container
   */
  async run(options: RunOptions): Promise<RunResult> {
    const jobId = randomUUID();
    const workspacePath = `/workspaces/${jobId}`;
    const hostUser = process.env.HOST_USER || process.env.USER || 'claude';
    const timeout = options.timeoutMs || 600000; // 10 minutes default

    // Track matched category for infrastructure cleanup
    let matchedCategory: CategoryConfig | undefined;

    console.log(`[ClaudeCode:${jobId}] Starting execution`, {
      repo: options.repoUrl,
      branch: options.branch,
      labels: options.eventLabels,
    });

    try {
      // Clone repository
      console.log(`[ClaudeCode:${jobId}] Cloning repository...`);
      await execAsync(
        `git clone --depth 1 -b ${options.branch} ${options.repoUrl} ${workspacePath}`,
        { timeout: 60000 }
      );

      // Create fix branch
      const fixBranch = `fix/auto-${jobId.slice(0, 8)}`;
      console.log(`[ClaudeCode:${jobId}] Creating branch ${fixBranch}`);
      await execAsync(`git checkout -b ${fixBranch}`, { cwd: workspacePath });

      // Read .ai-bugs.json if it exists
      let bugConfig: BugFixConfig | undefined;
      try {
        const configPath = join(workspacePath, '.ai-bugs.json');
        const content = await readFile(configPath, 'utf-8');
        const parsed = JSON.parse(content);
        const validation = validateBugConfig(parsed);
        if (validation.valid) {
          bugConfig = validation.config;
          console.log(`[ClaudeCode:${jobId}] Loaded .ai-bugs.json`);
        } else {
          console.warn(
            `[ClaudeCode:${jobId}] Invalid .ai-bugs.json: ${validation.error}`
          );
        }
      } catch {
        console.log(`[ClaudeCode:${jobId}] No .ai-bugs.json found, using defaults`);
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

      // Build environment variables (runner is sandboxed - no external tokens)
      const envVars = {
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

      // Enhance prompt with category-specific requirements
      const enhancedPrompt = buildCategoryPrompt(
        options.prompt,
        bugConfig,
        eventLabels
      );

      // Escape prompt for shell
      const escapedPrompt = enhancedPrompt
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/`/g, '\\`')
        .replace(/\$/g, '\\$');

      // Run Claude Code
      console.log(`[ClaudeCode:${jobId}] Running Claude Code CLI...`);
      const { stdout } = await execAsync(
        `
        docker run --rm \
          --name claude-${jobId.slice(0, 8)} \
          --network ${process.env.DOCKER_NETWORK || 'ai-bug-fixer_internal'} \
          -v ${workspacePath}:/workspace \
          -v /Users/${hostUser}/.claude:/home/agent/.claude:ro \
          ${envFlags} \
          ${pathEnv} \
          --cpus="2" \
          --memory="4g" \
          --pids-limit 100 \
          agent-runner-claude:latest \
          --print \
          --dangerously-skip-permissions \
          --max-turns 30 \
          -p "${escapedPrompt}"
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

      // Cleanup workspace
      console.log(`[ClaudeCode:${jobId}] Cleaning up workspace...`);
      await rm(workspacePath, { recursive: true, force: true }).catch((err) => {
        console.error(
          `[ClaudeCode:${jobId}] Failed to cleanup workspace:`,
          getErrorMessage(err)
        );
      });
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
}
