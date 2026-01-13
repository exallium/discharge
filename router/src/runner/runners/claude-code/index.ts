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
import type { RunnerConversationResult, RunnerAction, PlanFile } from '../../../types/conversation';
import {
  buildConversationSystemPrompt,
  buildUserMessage,
  formatConversationHistory,
  buildPlanCreationPrompt,
  buildPlanIterationPrompt,
  buildExecutionPrompt,
} from '../../../conversation/prompts';
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

  // Conversation support
  supportsConversation = true;

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
    const workspacePath = options.workspacePath || `/workspaces/${jobId}`;
    const hostUser = process.env.HOST_USER || process.env.USER || 'claude';
    const timeout = options.timeoutMs || 600000;

    console.log(`[ClaudeCode:${jobId}] Starting conversation mode execution`, {
      repo: options.repoUrl,
      branch: options.branch,
      routeMode: options.routeMode,
      iteration: options.iteration,
      hasExistingPlan: !!options.existingPlan,
    });

    try {
      // Use provided workspace or clone repository
      const isPreConfiguredWorkspace = !!options.workspacePath;

      if (!isPreConfiguredWorkspace) {
        console.log(`[ClaudeCode:${jobId}] Cloning repository...`);
        await execAsync(
          `git clone --depth 1 -b ${options.branch} ${options.repoUrl} ${workspacePath}`,
          { timeout: 60000 }
        );
      }

      // Create fix branch if not already on one
      const fixBranch = `fix/conversation-${jobId.slice(0, 8)}`;
      console.log(`[ClaudeCode:${jobId}] Creating branch ${fixBranch}`);
      await execAsync(`git checkout -b ${fixBranch}`, { cwd: workspacePath }).catch(() => {
        // Branch might already exist if using pre-configured workspace
        console.log(`[ClaudeCode:${jobId}] Branch already exists, continuing...`);
      });

      // Build the conversation prompt
      const conversationPrompt = this.buildConversationPrompt(options);

      // Escape prompt for shell
      const escapedPrompt = conversationPrompt
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/`/g, '\\`')
        .replace(/\$/g, '\\$');

      // Build environment variables
      const envVars = {
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

      // Run Claude Code
      console.log(`[ClaudeCode:${jobId}] Running Claude Code CLI in conversation mode...`);
      const { stdout } = await execAsync(
        `
        docker run --rm \
          --name claude-conv-${jobId.slice(0, 8)} \
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
      console.error(`[ClaudeCode:${jobId}] Conversation execution failed:`, errorMessage);

      return {
        response: `Execution failed: ${errorMessage}`,
        action: { type: 'comment', body: `I encountered an error: ${errorMessage}` },
        complete: false,
      };
    } finally {
      // Only cleanup if we created the workspace
      if (!options.workspacePath) {
        console.log(`[ClaudeCode:${jobId}] Cleaning up workspace...`);
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
    parts.push('After completing your analysis or work, create a file at `.claude/conversation-result.json` with:');
    parts.push('```json');
    parts.push('{');
    parts.push('  "response": "Your response message",');
    parts.push('  "action": {');
    parts.push('    "type": "create_plan|update_plan|execute|comment|request_info",');
    parts.push('    "plan": { /* PlanFile structure if type is create_plan */ },');
    parts.push('    "content": "/* updated content if type is update_plan */",');
    parts.push('    "body": "/* message if type is comment */",');
    parts.push('    "questions": ["/* questions if type is request_info */"]');
    parts.push('  },');
    parts.push('  "complete": false');
    parts.push('}');
    parts.push('```');

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

      // Validate required fields
      if (result.response && result.action) {
        return result;
      }
    } catch {
      console.log('[ClaudeCode] No conversation-result.json found, parsing from output');
    }

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
        issue: options.iteration,
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
}
