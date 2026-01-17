/**
 * Workspace Manager
 *
 * Manages git repositories and worktrees for efficient job execution.
 * Uses bare repositories with worktrees to avoid full clones for each job.
 *
 * Directory structure:
 *   /workspaces/
 *     /<project-id>/
 *       /repo.git/                 # Bare clone (shared .git objects)
 *       /worktrees/
 *         /<job-id>/               # Worktree for this job
 *         /<job-id>.meta           # Metadata: created_at, branch, status
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { mkdir, rm, readFile, writeFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { getErrorMessage } from '../types/errors';
import { getGitHubToken } from '../vcs';
import { logger } from '../logger';

const execAsync = promisify(exec);

/**
 * Workspace root directory
 * In Docker: mounted as a named volume at /workspaces
 * Locally: can override with WORKSPACE_ROOT env var
 */
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || '/workspaces';

/**
 * Default TTL for stale worktrees (24 hours)
 */
const STALE_WORKTREE_TTL_HOURS = parseInt(process.env.STALE_WORKTREE_TTL_HOURS || '24', 10);

/**
 * Worktree metadata
 */
interface WorktreeMeta {
  createdAt: string;
  branch: string;
  jobId: string;
  status: 'active' | 'completed' | 'failed';
}

/**
 * Project repository info
 */
interface ProjectRepo {
  projectId: string;
  repoPath: string;      // Path to bare repo
  worktreesPath: string; // Path to worktrees directory
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
 * Get paths for a project's repository storage
 */
function getProjectPaths(projectId: string): ProjectRepo {
  const projectDir = join(WORKSPACE_ROOT, projectId);
  return {
    projectId,
    repoPath: join(projectDir, 'repo.git'),
    worktreesPath: join(projectDir, 'worktrees'),
  };
}

/**
 * Check if a bare repository exists for a project
 */
async function hasProjectRepo(projectId: string): Promise<boolean> {
  const { repoPath } = getProjectPaths(projectId);
  return existsSync(join(repoPath, 'HEAD'));
}

/**
 * Initialize or fetch a bare repository for a project
 *
 * @param projectId - Project identifier
 * @param repoUrl - Git repository URL
 * @returns Path to the bare repository
 */
export async function getOrCreateRepo(
  projectId: string,
  repoUrl: string
): Promise<string> {
  const { repoPath, worktreesPath } = getProjectPaths(projectId);

  // Ensure directories exist
  await mkdir(worktreesPath, { recursive: true });

  if (await hasProjectRepo(projectId)) {
    // Repository exists - fetch latest
    logger.debug('Fetching updates for existing repo', { projectId });
    await syncRepo(repoPath);
    return repoPath;
  }

  // Clone new bare repository
  logger.info('Cloning bare repository', { projectId, repoUrl });

  const authUrl = await getAuthenticatedRepoUrl(repoUrl);

  try {
    await execAsync(
      `git clone --bare ${authUrl} ${repoPath}`,
      { timeout: 300000 } // 5 minutes for initial clone
    );

    // Configure for worktree support
    await execAsync(
      'git config core.bare false && git config core.worktree /dev/null',
      { cwd: repoPath }
    );

    logger.info('Bare repository created', { projectId, repoPath });
    return repoPath;
  } catch (error) {
    logger.error('Failed to clone bare repository', {
      projectId,
      error: getErrorMessage(error),
    });
    throw error;
  }
}

/**
 * Fetch all updates for a repository
 */
export async function syncRepo(repoPath: string): Promise<void> {
  try {
    // Update the remote URL with fresh token (tokens may expire)
    const { stdout: remoteUrl } = await execAsync(
      'git remote get-url origin',
      { cwd: repoPath }
    );

    // Re-authenticate the URL
    const authUrl = await getAuthenticatedRepoUrl(remoteUrl.trim());
    await execAsync(`git remote set-url origin "${authUrl}"`, { cwd: repoPath });

    // Fetch all refs
    await execAsync('git fetch --all --prune', { cwd: repoPath, timeout: 120000 });

    logger.debug('Repository synced', { repoPath });
  } catch (error) {
    logger.error('Failed to sync repository', {
      repoPath,
      error: getErrorMessage(error),
    });
    throw error;
  }
}

/**
 * Create a worktree for a job
 *
 * @param projectId - Project identifier
 * @param jobId - Job identifier
 * @param branch - Branch to checkout
 * @param repoUrl - Repository URL (used if repo doesn't exist yet)
 * @returns Path to the worktree
 */
export async function createWorktree(
  projectId: string,
  jobId: string,
  branch: string,
  repoUrl: string
): Promise<string> {
  const { repoPath, worktreesPath } = getProjectPaths(projectId);
  const worktreePath = join(worktreesPath, jobId);
  const metaPath = `${worktreePath}.meta`;

  // Ensure repo exists
  await getOrCreateRepo(projectId, repoUrl);

  logger.info('Creating worktree', { projectId, jobId, branch });

  try {
    // Create worktree from the specified branch
    // Use origin/<branch> to ensure we get the remote version
    await execAsync(
      `git worktree add "${worktreePath}" "origin/${branch}" --detach`,
      { cwd: repoPath, timeout: 60000 }
    );

    // Create a new branch for the job
    const fixBranch = `fix/auto-${jobId.slice(0, 8)}`;
    await execAsync(`git checkout -b "${fixBranch}"`, { cwd: worktreePath });

    // Write metadata
    const meta: WorktreeMeta = {
      createdAt: new Date().toISOString(),
      branch: fixBranch,
      jobId,
      status: 'active',
    };
    await writeFile(metaPath, JSON.stringify(meta, null, 2));

    logger.info('Worktree created', {
      projectId,
      jobId,
      worktreePath,
      branch: fixBranch,
    });

    return worktreePath;
  } catch (error) {
    logger.error('Failed to create worktree', {
      projectId,
      jobId,
      error: getErrorMessage(error),
    });
    throw error;
  }
}

/**
 * Remove a worktree after job completion
 */
export async function removeWorktree(
  projectId: string,
  jobId: string
): Promise<void> {
  const { repoPath, worktreesPath } = getProjectPaths(projectId);
  const worktreePath = join(worktreesPath, jobId);
  const metaPath = `${worktreePath}.meta`;

  logger.debug('Removing worktree', { projectId, jobId });

  try {
    // Remove from git worktree list
    await execAsync(`git worktree remove "${worktreePath}" --force`, {
      cwd: repoPath,
    }).catch(() => {
      // Worktree might already be removed
    });

    // Clean up directory if it still exists
    if (existsSync(worktreePath)) {
      await rm(worktreePath, { recursive: true, force: true });
    }

    // Remove metadata file
    if (existsSync(metaPath)) {
      await rm(metaPath);
    }

    // Prune orphaned worktree references
    await execAsync('git worktree prune', { cwd: repoPath }).catch(() => {});

    logger.debug('Worktree removed', { projectId, jobId });
  } catch (error) {
    logger.error('Failed to remove worktree', {
      projectId,
      jobId,
      error: getErrorMessage(error),
    });
    // Don't throw - cleanup failures shouldn't block job completion
  }
}

/**
 * Update worktree status
 */
export async function updateWorktreeStatus(
  projectId: string,
  jobId: string,
  status: 'active' | 'completed' | 'failed'
): Promise<void> {
  const { worktreesPath } = getProjectPaths(projectId);
  const metaPath = join(worktreesPath, `${jobId}.meta`);

  try {
    if (existsSync(metaPath)) {
      const content = await readFile(metaPath, 'utf-8');
      const meta: WorktreeMeta = JSON.parse(content);
      meta.status = status;
      await writeFile(metaPath, JSON.stringify(meta, null, 2));
    }
  } catch (error) {
    logger.debug('Failed to update worktree status', {
      projectId,
      jobId,
      error: getErrorMessage(error),
    });
  }
}

/**
 * Clean up stale worktrees across all projects
 *
 * @param maxAgeHours - Maximum age in hours before a worktree is considered stale
 * @returns Number of worktrees removed
 */
export async function cleanupStaleWorktrees(
  maxAgeHours: number = STALE_WORKTREE_TTL_HOURS
): Promise<number> {
  logger.info('Starting stale worktree cleanup', { maxAgeHours });

  let removedCount = 0;
  const cutoffTime = Date.now() - maxAgeHours * 60 * 60 * 1000;

  try {
    // Check if workspace root exists
    if (!existsSync(WORKSPACE_ROOT)) {
      logger.debug('Workspace root does not exist, nothing to clean');
      return 0;
    }

    // Iterate through all project directories
    const projects = await readdir(WORKSPACE_ROOT);

    for (const projectId of projects) {
      const { worktreesPath } = getProjectPaths(projectId);

      if (!existsSync(worktreesPath)) {
        continue;
      }

      // Find all meta files
      const files = await readdir(worktreesPath);
      const metaFiles = files.filter((f) => f.endsWith('.meta'));

      for (const metaFile of metaFiles) {
        const metaPath = join(worktreesPath, metaFile);

        try {
          const content = await readFile(metaPath, 'utf-8');
          const meta: WorktreeMeta = JSON.parse(content);

          // Check if worktree is stale
          const createdAt = new Date(meta.createdAt).getTime();
          const isStale = createdAt < cutoffTime;
          const isNotActive = meta.status !== 'active';

          if (isStale || isNotActive) {
            const jobId = metaFile.replace('.meta', '');
            logger.info('Removing stale worktree', {
              projectId,
              jobId,
              age: Math.round((Date.now() - createdAt) / 3600000) + ' hours',
              status: meta.status,
            });

            await removeWorktree(projectId, jobId);
            removedCount++;
          }
        } catch (error) {
          logger.debug('Failed to process meta file', {
            metaPath,
            error: getErrorMessage(error),
          });
        }
      }

      // Prune orphaned worktree refs for this project
      const { repoPath } = getProjectPaths(projectId);
      if (existsSync(repoPath)) {
        await execAsync('git worktree prune', { cwd: repoPath }).catch(() => {});
      }
    }

    logger.info('Stale worktree cleanup completed', { removedCount });
    return removedCount;
  } catch (error) {
    logger.error('Failed to cleanup stale worktrees', {
      error: getErrorMessage(error),
    });
    return removedCount;
  }
}

/**
 * Get worktree info for a job
 */
export async function getWorktreeInfo(
  projectId: string,
  jobId: string
): Promise<WorktreeMeta | null> {
  const { worktreesPath } = getProjectPaths(projectId);
  const metaPath = join(worktreesPath, `${jobId}.meta`);

  try {
    if (existsSync(metaPath)) {
      const content = await readFile(metaPath, 'utf-8');
      return JSON.parse(content);
    }
  } catch {
    // Ignore errors
  }

  return null;
}

/**
 * List all active worktrees for a project
 */
export async function listWorktrees(projectId: string): Promise<WorktreeMeta[]> {
  const { worktreesPath } = getProjectPaths(projectId);
  const worktrees: WorktreeMeta[] = [];

  try {
    if (!existsSync(worktreesPath)) {
      return worktrees;
    }

    const files = await readdir(worktreesPath);
    const metaFiles = files.filter((f) => f.endsWith('.meta'));

    for (const metaFile of metaFiles) {
      const metaPath = join(worktreesPath, metaFile);
      try {
        const content = await readFile(metaPath, 'utf-8');
        worktrees.push(JSON.parse(content));
      } catch {
        // Skip invalid meta files
      }
    }
  } catch {
    // Ignore errors
  }

  return worktrees;
}

/**
 * Get the workspace root path
 */
export function getWorkspaceRoot(): string {
  return WORKSPACE_ROOT;
}
