/**
 * Repository Manager
 *
 * Manages repository clones and worktrees efficiently:
 * - Maintains cached bare clones to avoid repeated full clones
 * - Creates isolated worktrees for each job
 * - Handles cleanup and pruning of stale worktrees
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { mkdir, access, rm, readdir, stat } from 'fs/promises';
import { join, dirname } from 'path';
import { createHash } from 'crypto';
import { logger } from '../logger';

const execAsync = promisify(exec);

/**
 * Parse a git remote URL into components
 */
interface RepoInfo {
  host: string;
  owner: string;
  repo: string;
}

function parseRepoUrl(repoUrl: string): RepoInfo {
  // Handle SSH URLs: git@github.com:owner/repo.git
  const sshMatch = repoUrl.match(/git@([^:]+):([^/]+)\/([^.]+)(?:\.git)?$/);
  if (sshMatch) {
    return {
      host: sshMatch[1],
      owner: sshMatch[2],
      repo: sshMatch[3],
    };
  }

  // Handle HTTPS URLs: https://github.com/owner/repo.git
  const httpsMatch = repoUrl.match(
    /https?:\/\/([^/]+)\/([^/]+)\/([^/.]+)(?:\.git)?$/
  );
  if (httpsMatch) {
    return {
      host: httpsMatch[1],
      owner: httpsMatch[2],
      repo: httpsMatch[3],
    };
  }

  // Fallback: hash the URL
  const hash = createHash('sha256').update(repoUrl).digest('hex').slice(0, 16);
  return {
    host: 'unknown',
    owner: 'unknown',
    repo: hash,
  };
}

/**
 * Worktree result with cleanup function
 */
export interface WorktreeResult {
  /** Path to the worktree directory */
  path: string;
  /** Branch name in the worktree */
  branch: string;
  /** Call this to cleanup the worktree when done */
  cleanup: () => Promise<void>;
}

/**
 * Repository Manager for efficient clone and worktree management
 */
export class RepoManager {
  private readonly cacheDir: string;
  private readonly worktreeDir: string;
  private readonly cloneTimeout: number;
  private readonly locks: Map<string, Promise<void>> = new Map();

  constructor(options?: {
    cacheDir?: string;
    worktreeDir?: string;
    cloneTimeout?: number;
  }) {
    this.cacheDir = options?.cacheDir || process.env.REPO_CACHE_DIR || '/repos';
    this.worktreeDir =
      options?.worktreeDir || process.env.WORKTREE_DIR || '/workspaces';
    this.cloneTimeout = options?.cloneTimeout || 120000; // 2 minutes
  }

  /**
   * Get the cache path for a repository
   */
  private getCachePath(repoUrl: string): string {
    const info = parseRepoUrl(repoUrl);
    return join(this.cacheDir, info.host, info.owner, `${info.repo}.git`);
  }

  /**
   * Ensure the cache directory exists
   */
  private async ensureDir(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true });
  }

  /**
   * Check if a directory exists
   */
  private async exists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Wait for any existing operation on this repo to complete
   */
  private async waitForLock(repoUrl: string): Promise<void> {
    const existing = this.locks.get(repoUrl);
    if (existing) {
      await existing;
    }
  }

  /**
   * Ensure a bare clone exists for the repository
   * Creates it if it doesn't exist, or fetches updates if it does
   */
  async ensureRepoCache(repoUrl: string): Promise<string> {
    const cachePath = this.getCachePath(repoUrl);

    // Wait for any existing operations
    await this.waitForLock(repoUrl);

    // Create a new lock for this operation
    let resolveLock: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      resolveLock = resolve;
    });
    this.locks.set(repoUrl, lockPromise);

    try {
      if (await this.exists(join(cachePath, 'HEAD'))) {
        // Cache exists, fetch latest
        logger.debug('Fetching updates for cached repo', { cachePath });
        await execAsync('git fetch --all --prune', {
          cwd: cachePath,
          timeout: this.cloneTimeout,
        });
      } else {
        // Clone fresh bare repo
        logger.info('Creating bare clone', { repoUrl, cachePath });
        await this.ensureDir(dirname(cachePath));
        await execAsync(`git clone --bare "${repoUrl}" "${cachePath}"`, {
          timeout: this.cloneTimeout,
        });
      }

      return cachePath;
    } finally {
      this.locks.delete(repoUrl);
      resolveLock!();
    }
  }

  /**
   * Update the cached repository (fetch latest from origin)
   */
  async updateCache(repoUrl: string): Promise<void> {
    const cachePath = this.getCachePath(repoUrl);

    if (!(await this.exists(join(cachePath, 'HEAD')))) {
      throw new Error(`No cache exists for ${repoUrl}`);
    }

    await this.waitForLock(repoUrl);

    let resolveLock: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      resolveLock = resolve;
    });
    this.locks.set(repoUrl, lockPromise);

    try {
      logger.debug('Updating repo cache', { repoUrl, cachePath });
      await execAsync('git fetch --all --prune', {
        cwd: cachePath,
        timeout: this.cloneTimeout,
      });
    } finally {
      this.locks.delete(repoUrl);
      resolveLock!();
    }
  }

  /**
   * Create an isolated worktree for a job
   * Returns the worktree path and a cleanup function
   */
  async createWorktree(
    repoUrl: string,
    branch: string,
    jobId: string
  ): Promise<WorktreeResult> {
    // Ensure cache exists
    const cachePath = await this.ensureRepoCache(repoUrl);

    // Create worktree directory
    const worktreePath = join(this.worktreeDir, jobId);
    await this.ensureDir(dirname(worktreePath));

    // Fetch the specific branch first
    logger.debug('Fetching branch for worktree', { branch, cachePath });
    await execAsync(`git fetch origin "${branch}"`, {
      cwd: cachePath,
      timeout: 60000,
    }).catch(() => {
      // Branch might already exist locally, continue anyway
    });

    // Create worktree from the branch
    logger.debug('Creating worktree', { worktreePath, branch });
    try {
      // Try with tracking branch first
      await execAsync(
        `git worktree add "${worktreePath}" "origin/${branch}" --detach`,
        { cwd: cachePath, timeout: 30000 }
      );
    } catch {
      // Fallback: try without origin prefix
      await execAsync(`git worktree add "${worktreePath}" "${branch}"`, {
        cwd: cachePath,
        timeout: 30000,
      });
    }

    // Create a new branch in the worktree for the job
    const fixBranch = `fix/auto-${jobId.slice(0, 8)}`;
    await execAsync(`git checkout -b "${fixBranch}"`, {
      cwd: worktreePath,
      timeout: 10000,
    });

    logger.info('Worktree created', { worktreePath, branch: fixBranch, jobId });

    // Return result with cleanup function
    return {
      path: worktreePath,
      branch: fixBranch,
      cleanup: async () => {
        await this.removeWorktree(cachePath, worktreePath);
      },
    };
  }

  /**
   * Remove a worktree and clean up
   */
  private async removeWorktree(
    cachePath: string,
    worktreePath: string
  ): Promise<void> {
    try {
      // Remove the worktree using git
      logger.debug('Removing worktree', { worktreePath });
      await execAsync(`git worktree remove "${worktreePath}" --force`, {
        cwd: cachePath,
        timeout: 30000,
      });
    } catch (error) {
      // Fallback: force remove the directory
      logger.warn('Git worktree remove failed, using rm', {
        worktreePath,
        error: error instanceof Error ? error.message : String(error),
      });
      await rm(worktreePath, { recursive: true, force: true });
    }

    // Prune stale worktrees
    try {
      await execAsync('git worktree prune', { cwd: cachePath, timeout: 10000 });
    } catch {
      // Non-fatal, continue
    }

    logger.debug('Worktree removed', { worktreePath });
  }

  /**
   * Prune stale worktrees for a repository
   */
  async pruneWorktrees(repoUrl: string): Promise<void> {
    const cachePath = this.getCachePath(repoUrl);

    if (!(await this.exists(join(cachePath, 'HEAD')))) {
      return; // No cache, nothing to prune
    }

    logger.debug('Pruning worktrees', { cachePath });
    await execAsync('git worktree prune', {
      cwd: cachePath,
      timeout: 10000,
    });
  }

  /**
   * Clean up all stale worktrees in the worktree directory
   */
  async cleanupStaleWorktrees(maxAgeMs: number = 24 * 60 * 60 * 1000): Promise<number> {
    let cleaned = 0;

    if (!(await this.exists(this.worktreeDir))) {
      return cleaned;
    }

    const entries = await readdir(this.worktreeDir);
    const now = Date.now();

    for (const entry of entries) {
      const worktreePath = join(this.worktreeDir, entry);
      try {
        const stats = await stat(worktreePath);
        if (now - stats.mtimeMs > maxAgeMs) {
          logger.info('Cleaning up stale worktree', { worktreePath });
          await rm(worktreePath, { recursive: true, force: true });
          cleaned++;
        }
      } catch {
        // Entry might have been removed, continue
      }
    }

    if (cleaned > 0) {
      logger.info('Cleaned up stale worktrees', { count: cleaned });
    }

    return cleaned;
  }

  /**
   * Get statistics about the cache
   */
  async getStats(): Promise<{
    cachedRepos: number;
    activeWorktrees: number;
    cacheSize: string;
  }> {
    let cachedRepos = 0;
    let activeWorktrees = 0;

    // Count cached repos
    const countRepos = async (dir: string): Promise<number> => {
      if (!(await this.exists(dir))) return 0;
      let count = 0;
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const path = join(dir, entry.name);
          if (entry.name.endsWith('.git')) {
            count++;
          } else {
            count += await countRepos(path);
          }
        }
      }
      return count;
    };

    cachedRepos = await countRepos(this.cacheDir);

    // Count active worktrees
    if (await this.exists(this.worktreeDir)) {
      const entries = await readdir(this.worktreeDir);
      activeWorktrees = entries.length;
    }

    // Get cache size (simplified - just count entries)
    return {
      cachedRepos,
      activeWorktrees,
      cacheSize: `${cachedRepos} repos`,
    };
  }
}

// Default singleton instance
let defaultManager: RepoManager | null = null;

/**
 * Get the default RepoManager instance
 */
export function getRepoManager(): RepoManager {
  if (!defaultManager) {
    defaultManager = new RepoManager();
  }
  return defaultManager;
}

/**
 * Initialize the RepoManager (create directories, etc.)
 */
export async function initializeRepoManager(): Promise<RepoManager> {
  const manager = getRepoManager();

  // Ensure directories exist
  const cacheDir = process.env.REPO_CACHE_DIR || '/repos';
  const worktreeDir = process.env.WORKTREE_DIR || '/workspaces';

  await mkdir(cacheDir, { recursive: true });
  await mkdir(worktreeDir, { recursive: true });

  logger.info('RepoManager initialized', { cacheDir, worktreeDir });

  return manager;
}
