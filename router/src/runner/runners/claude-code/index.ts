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

    console.log(`[ClaudeCode:${jobId}] Starting execution`, {
      repo: options.repoUrl,
      branch: options.branch,
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

      // Write tools to workspace if provided
      if (options.tools && options.tools.length > 0) {
        await this.writeToolsToWorkspace(workspacePath, options.tools);
      }

      // Build environment variables
      const envVars = {
        SENTRY_AUTH_TOKEN: process.env.SENTRY_AUTH_TOKEN || '',
        CIRCLECI_TOKEN: process.env.CIRCLECI_TOKEN || '',
        GITHUB_TOKEN: process.env.GITHUB_TOKEN || '',
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

      // Escape prompt for shell
      const escapedPrompt = options.prompt
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
          -v /Users/${hostUser}/.claude:/home/claude/.claude:ro \
          ${envFlags} \
          ${pathEnv} \
          --cpus="2" \
          --memory="4g" \
          --pids-limit 100 \
          claude-runner:latest \
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
      } catch (error) {
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
    } catch (error: any) {
      console.error(`[ClaudeCode:${jobId}] Execution failed:`, error.message);

      return {
        success: false,
        jobId,
        output: error.stdout || error.message,
        hasCommit: false,
        error: error.message,
      };
    } finally {
      // Cleanup workspace
      console.log(`[ClaudeCode:${jobId}] Cleaning up workspace...`);
      await rm(workspacePath, { recursive: true, force: true }).catch((err) => {
        console.error(
          `[ClaudeCode:${jobId}] Failed to cleanup workspace:`,
          err.message
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

      // Check claude-runner image exists
      const { stdout } = await execAsync(
        'docker images -q claude-runner:latest'
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
        'docker images -q claude-runner:latest'
      );
      if (stdout.trim().length === 0) {
        return {
          valid: false,
          error:
            'claude-runner:latest image not found. Run: docker compose --profile build-only build',
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
