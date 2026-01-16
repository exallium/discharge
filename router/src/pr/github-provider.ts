/**
 * GitHub PR Provider
 *
 * Implements PRProvider for GitHub repositories.
 * Manages token lookup and creates GitHubVCS instances on demand.
 */

import type { ProjectConfig } from '../config/projects';
import type { PRProvider, PRResult, CreatePROptions, CompareOptions } from './provider';
import { GitHubVCS } from '../vcs/github';
import { getGitHubToken } from '../vcs';
import { getErrorMessage } from '../types/errors';
import { logger } from '../logger';

/**
 * GitHub PR Provider
 * Creates PRs on GitHub repositories
 */
export class GitHubPRProvider implements PRProvider {
  id = 'github';

  /**
   * Check if we can create PRs for this project
   * Returns true if GitHub token is available
   */
  async canCreatePR(project: ProjectConfig): Promise<boolean> {
    // Only handle GitHub repositories
    if (project.vcs.type !== 'github') {
      return false;
    }

    // Check if token is available
    const token = await getGitHubToken(project.id);
    return token !== null;
  }

  /**
   * Create a pull request on GitHub
   */
  async createPullRequest(options: CreatePROptions): Promise<PRResult> {
    try {
      // Get token (we should have verified it's available via canCreatePR)
      // Note: We use undefined for projectId here since we don't have it in CreatePROptions
      // In practice, the caller should ensure canCreatePR was called first
      const token = await getGitHubToken();
      if (!token) {
        return {
          success: false,
          compareUrl: this.getCompareUrl(options),
          error: 'GitHub token not configured',
        };
      }

      const vcs = new GitHubVCS(token);
      const pr = await vcs.createPullRequest(
        options.owner,
        options.repo,
        options.head,
        options.base,
        options.title,
        options.body
      );

      logger.info('Created PR via GitHub provider', {
        owner: options.owner,
        repo: options.repo,
        prNumber: pr.number,
      });

      return {
        success: true,
        prNumber: pr.number,
        prUrl: pr.htmlUrl,
      };
    } catch (error) {
      logger.error('Failed to create PR via GitHub provider', {
        owner: options.owner,
        repo: options.repo,
        error: getErrorMessage(error),
      });

      return {
        success: false,
        compareUrl: this.getCompareUrl(options),
        error: getErrorMessage(error) || 'Failed to create pull request',
      };
    }
  }

  /**
   * Get compare URL for GitHub
   */
  getCompareUrl(options: CompareOptions): string {
    return `https://github.com/${options.owner}/${options.repo}/compare/${options.base}...${options.head}`;
  }
}

/**
 * Singleton instance
 */
let instance: GitHubPRProvider | null = null;

/**
 * Get or create the GitHub PR provider instance
 */
export function getGitHubPRProvider(): GitHubPRProvider {
  if (!instance) {
    instance = new GitHubPRProvider();
  }
  return instance;
}
