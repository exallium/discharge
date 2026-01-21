import { exec } from 'child_process';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import { rm, readFile } from 'fs/promises';
import { join } from 'path';
import type { AnalysisResult } from '@ai-bug-fixer/service-sdk';
import { getErrorMessage, isExecError } from '../types/errors';
import { getSecret } from '../secrets';

const execAsync = promisify(exec);

/**
 * Options for running Claude in a container
 */
export interface RunClaudeOptions {
  repoUrl: string;
  branch: string;
  prompt: string;
  toolsDir?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
}

/**
 * Result from running Claude
 */
export interface RunClaudeResult {
  success: boolean;
  jobId: string;
  output: string;
  hasCommit: boolean;
  analysis?: AnalysisResult;
  branchName?: string;
  error?: string;
}

/**
 * Run Claude Code CLI in a Docker container
 */
export async function runClaudeInContainer(
  options: RunClaudeOptions
): Promise<RunClaudeResult> {
  const jobId = randomUUID();
  const worktreeDir = process.env.WORKTREE_DIR || '/workspaces';
  const workspacePath = `${worktreeDir}/${jobId}`;
  const hostUser = process.env.HOST_USER || process.env.USER || 'claude';
  const timeout = options.timeoutMs || 600000; // 10 minutes default

  console.log(`[${jobId}] Starting Claude container`, {
    repo: options.repoUrl,
    branch: options.branch,
  });

  try {
    // Clone repository
    console.log(`[${jobId}] Cloning repository...`);
    await execAsync(
      `git clone --depth 1 -b ${options.branch} ${options.repoUrl} ${workspacePath}`,
      { timeout: 60000 }
    );

    // Create fix branch
    const fixBranch = `fix/auto-${jobId.slice(0, 8)}`;
    console.log(`[${jobId}] Creating branch ${fixBranch}`);
    await execAsync(`git checkout -b ${fixBranch}`, { cwd: workspacePath });

    // Build environment variables from secrets store
    const [sentryToken, circleCiToken, githubToken] = await Promise.all([
      getSecret('sentry', 'auth_token'),
      getSecret('circleci', 'token'),
      getSecret('github', 'token'),
    ]);

    const envVars = {
      SENTRY_AUTH_TOKEN: sentryToken || '',
      CIRCLECI_TOKEN: circleCiToken || '',
      GITHUB_TOKEN: githubToken || '',
      ...options.env,
    };

    const envFlags = Object.entries(envVars)
      .filter(([_, v]) => v) // Only include non-empty values
      .map(([k, v]) => `-e ${k}="${v}"`)
      .join(' ');

    // Add tools directory to PATH if provided
    const pathEnv = options.toolsDir
      ? `-e PATH="/workspace/.claude-tools:$PATH"`
      : '';

    // Escape prompt for shell
    const escapedPrompt = options.prompt
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/`/g, '\\`')
      .replace(/\$/g, '\\$');

    // Run Claude
    console.log(`[${jobId}] Running Claude Code...`);
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

    console.log(`[${jobId}] Claude execution completed`);

    // Check for commits
    const { stdout: gitLog } = await execAsync(
      'git log --oneline -1 2>/dev/null || echo "no commits"',
      { cwd: workspacePath }
    );
    const hasCommit = !gitLog.includes('no commits') && gitLog.trim().length > 0;

    if (hasCommit) {
      console.log(`[${jobId}] Found commit: ${gitLog.trim()}`);
    }

    // Try to read analysis.json
    let analysis: AnalysisResult | undefined;
    try {
      const analysisPath = join(workspacePath, '.claude', 'analysis.json');
      const content = await readFile(analysisPath, 'utf-8');
      analysis = JSON.parse(content);
      if (analysis) {
        console.log(`[${jobId}] Analysis:`, {
          canAutoFix: analysis.canAutoFix,
          confidence: analysis.confidence,
        });
      }
    } catch {
      console.log(`[${jobId}] No analysis.json found`);
    }

    // Push branch if there's a commit
    if (hasCommit) {
      console.log(`[${jobId}] Pushing branch ${fixBranch}...`);
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
    console.error(`[${jobId}] Claude execution failed:`, errorMessage);

    return {
      success: false,
      jobId,
      output: isExecError(error) ? (error.stdout || errorMessage) : errorMessage,
      hasCommit: false,
      error: errorMessage,
    };
  } finally {
    // Cleanup workspace
    console.log(`[${jobId}] Cleaning up workspace...`);
    await rm(workspacePath, { recursive: true, force: true }).catch(err => {
      console.error(`[${jobId}] Failed to cleanup workspace:`, getErrorMessage(err));
    });
  }
}

/**
 * Check if Docker is available
 */
export async function isDockerAvailable(): Promise<boolean> {
  try {
    await execAsync('docker info', { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if agent-runner image exists
 */
export async function isClaudeRunnerImageAvailable(): Promise<boolean> {
  try {
    const { stdout } = await execAsync('docker images -q agent-runner-claude:latest');
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}
