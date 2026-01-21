/**
 * GitHub VCS Plugin
 *
 * Provides VCS operations for GitHub repositories using Octokit.
 * Supports GitHub App authentication (primary) or direct Octokit instance.
 */

import { Octokit } from '@octokit/rest';
import {
  VCSPlugin,
  PullRequest,
  PlanFileResult,
  VCSProjectConfig,
  SecretRequirement,
  getLogger,
  getErrorMessage,
} from '@ai-bug-fixer/service-sdk';

/**
 * GitHub VCS plugin using Octokit
 */
export class GitHubVCS implements VCSPlugin {
  id = 'github';
  type = 'github' as const;

  // Plan file support
  supportsPlanFiles = true;

  private octokit: Octokit;

  /**
   * Create a GitHubVCS instance with a pre-configured Octokit
   * Use the factory function getGitHubVCS() to create instances with proper auth
   */
  constructor(octokit: Octokit) {
    this.octokit = octokit;
  }

  async createPullRequest(
    owner: string,
    repo: string,
    head: string,
    base: string,
    title: string,
    body: string
  ): Promise<PullRequest> {
    const logger = getLogger();
    logger.info(`[GitHubVCS] Creating PR: ${owner}/${repo} ${head} -> ${base}`);

    const response = await this.octokit.pulls.create({
      owner,
      repo,
      title,
      body,
      head,
      base,
    });

    return {
      number: response.data.number,
      url: response.data.url,
      htmlUrl: response.data.html_url,
      title: response.data.title,
      body: response.data.body || '',
      head: response.data.head.ref,
      base: response.data.base.ref,
    };
  }

  getCompareUrl(owner: string, repo: string, base: string, head: string): string {
    return `https://github.com/${owner}/${repo}/compare/${base}...${head}`;
  }

  formatRepoIdentifier(owner: string, repo: string): string {
    return `${owner}/${repo}`;
  }

  async validate(): Promise<{ valid: boolean; error?: string }> {
    try {
      // Test authentication by getting user info
      await this.octokit.users.getAuthenticated();
      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        error: getErrorMessage(error) || 'GitHub authentication failed',
      };
    }
  }

  /**
   * Add a comment to a pull request
   */
  async addPRComment(
    owner: string,
    repo: string,
    prNumber: number,
    body: string
  ): Promise<void> {
    await this.octokit.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body,
    });
  }

  /**
   * Request reviewers for a pull request
   */
  async requestReviewers(
    owner: string,
    repo: string,
    prNumber: number,
    reviewers: string[]
  ): Promise<void> {
    if (reviewers.length === 0) return;

    await this.octokit.pulls.requestReviewers({
      owner,
      repo,
      pull_number: prNumber,
      reviewers,
    });
  }

  /**
   * Add labels to a pull request
   */
  async addLabels(
    owner: string,
    repo: string,
    prNumber: number,
    labels: string[]
  ): Promise<void> {
    if (labels.length === 0) return;

    await this.octokit.issues.addLabels({
      owner,
      repo,
      issue_number: prNumber,
      labels,
    });
  }

  // ========================================
  // Plan File Operations
  // ========================================

  /**
   * Create a plan file in the repository
   * Creates a branch, commits the file, and opens a PR
   */
  async createPlanFile(
    project: VCSProjectConfig,
    content: string,
    filePath: string,
    issueNumber?: number | string
  ): Promise<PlanFileResult> {
    const { owner, repo: repoName } = this.parseRepoIdentifier(project.repoFullName);
    const logger = getLogger();

    // Generate branch name
    const branchName = `ai-plan/${issueNumber || Date.now()}`;

    try {
      // Get default branch SHA
      const { data: repoData } = await this.octokit.repos.get({
        owner,
        repo: repoName,
      });
      const defaultBranch = repoData.default_branch;

      const { data: refData } = await this.octokit.git.getRef({
        owner,
        repo: repoName,
        ref: `heads/${defaultBranch}`,
      });
      const baseSha = refData.object.sha;

      // Create new branch (or update if it already exists)
      try {
        await this.octokit.git.createRef({
          owner,
          repo: repoName,
          ref: `refs/heads/${branchName}`,
          sha: baseSha,
        });
      } catch (error: unknown) {
        // Handle "Reference already exists" error (HTTP 422)
        const isRefExistsError =
          error &&
          typeof error === 'object' &&
          'status' in error &&
          error.status === 422 &&
          getErrorMessage(error).includes('Reference already exists');

        if (isRefExistsError) {
          logger.info('Branch already exists, updating to latest base', {
            owner,
            repo: repoName,
            branch: branchName,
          });
          // Update existing branch to point to latest base SHA
          await this.octokit.git.updateRef({
            owner,
            repo: repoName,
            ref: `heads/${branchName}`,
            sha: baseSha,
            force: true,
          });
        } else {
          throw error;
        }
      }

      // Create or update the file
      await this.octokit.repos.createOrUpdateFileContents({
        owner,
        repo: repoName,
        path: filePath,
        message: `Add AI fix plan for issue #${issueNumber}`,
        content: Buffer.from(content).toString('base64'),
        branch: branchName,
      });

      // Create PR
      const prTitle = issueNumber
        ? `[AI Plan] Fix for issue #${issueNumber}`
        : `[AI Plan] Implementation plan`;

      const prBody = issueNumber
        ? `This PR contains an AI-generated implementation plan for #${issueNumber}.\n\n**Review the plan and provide feedback.** The AI will iterate based on your comments.\n\n---\n_Generated by AI Bug Fixer_`
        : `This PR contains an AI-generated implementation plan.\n\n**Review the plan and provide feedback.** The AI will iterate based on your comments.\n\n---\n_Generated by AI Bug Fixer_`;

      let prNumber: number;
      let prUrl: string;

      try {
        const { data: prData } = await this.octokit.pulls.create({
          owner,
          repo: repoName,
          title: prTitle,
          body: prBody,
          head: branchName,
          base: defaultBranch,
        });
        prNumber = prData.number;
        prUrl = prData.html_url;
      } catch (error: unknown) {
        // Handle "A pull request already exists" error (HTTP 422)
        const isPrExistsError =
          error &&
          typeof error === 'object' &&
          'status' in error &&
          error.status === 422 &&
          getErrorMessage(error).includes('pull request already exists');

        if (isPrExistsError) {
          // Find the existing PR
          const { data: existingPrs } = await this.octokit.pulls.list({
            owner,
            repo: repoName,
            head: `${owner}:${branchName}`,
            base: defaultBranch,
            state: 'open',
          });

          if (existingPrs.length > 0) {
            const existingPr = existingPrs[0];
            prNumber = existingPr.number;
            prUrl = existingPr.html_url;
            logger.info('Using existing PR for plan', {
              owner,
              repo: repoName,
              branch: branchName,
              prNumber,
            });
          } else {
            throw new Error('PR already exists error but no open PR found');
          }
        } else {
          throw error;
        }
      }

      logger.info('Created plan file and PR', {
        owner,
        repo: repoName,
        branch: branchName,
        prNumber,
        filePath,
      });

      // Return plan reference (use branch:filepath as reference)
      return {
        planRef: `${branchName}:${filePath}`,
        branch: branchName,
        prNumber,
        url: prUrl,
      };
    } catch (error) {
      logger.error('Failed to create plan file', {
        owner,
        repo: repoName,
        error: getErrorMessage(error),
      });
      throw error;
    }
  }

  /**
   * Update an existing plan file
   */
  async updatePlanFile(
    project: VCSProjectConfig,
    planRef: string,
    content: string
  ): Promise<void> {
    const { owner, repo: repoName } = this.parseRepoIdentifier(project.repoFullName);
    const [branchName, filePath] = planRef.split(':');
    const logger = getLogger();

    if (!branchName || !filePath) {
      throw new Error(`Invalid planRef format: ${planRef}`);
    }

    try {
      // Try to get current file SHA (may not exist if branch was recreated)
      let existingSha: string | undefined;
      try {
        const { data: currentFile } = await this.octokit.repos.getContent({
          owner,
          repo: repoName,
          path: filePath,
          ref: branchName,
        });

        if (!Array.isArray(currentFile) && currentFile.type === 'file') {
          existingSha = currentFile.sha;
        }
      } catch (getError) {
        // File doesn't exist - that's OK, we'll create it
        const errorMessage = getErrorMessage(getError);
        if (!errorMessage.includes('Not Found')) {
          throw getError;
        }
        logger.info('Plan file does not exist, will create it', {
          owner,
          repo: repoName,
          branch: branchName,
          filePath,
        });
      }

      // Create or update the file
      await this.octokit.repos.createOrUpdateFileContents({
        owner,
        repo: repoName,
        path: filePath,
        message: existingSha ? 'Update AI fix plan based on feedback' : 'Create AI fix plan',
        content: Buffer.from(content).toString('base64'),
        ...(existingSha && { sha: existingSha }),
        branch: branchName,
      });

      logger.info(existingSha ? 'Updated plan file' : 'Created plan file', {
        owner,
        repo: repoName,
        branch: branchName,
        filePath,
      });
    } catch (error) {
      logger.error('Failed to update plan file', {
        owner,
        repo: repoName,
        planRef,
        error: getErrorMessage(error),
      });
      throw error;
    }
  }

  /**
   * Get plan file content
   */
  async getPlanFile(
    project: VCSProjectConfig,
    planRef: string
  ): Promise<string | null> {
    const { owner, repo: repoName } = this.parseRepoIdentifier(project.repoFullName);
    const [branchName, filePath] = planRef.split(':');

    if (!branchName || !filePath) {
      throw new Error(`Invalid planRef format: ${planRef}`);
    }

    try {
      const { data } = await this.octokit.repos.getContent({
        owner,
        repo: repoName,
        path: filePath,
        ref: branchName,
      });

      if (Array.isArray(data) || data.type !== 'file') {
        return null;
      }

      // Decode base64 content
      return Buffer.from(data.content, 'base64').toString('utf-8');
    } catch (error: unknown) {
      // Check if it's a 404 (file not found)
      if (error && typeof error === 'object' && 'status' in error && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Delete/close a plan file
   * Closes the associated PR and optionally deletes the branch
   */
  async deletePlanFile(
    project: VCSProjectConfig,
    planRef: string
  ): Promise<void> {
    const { owner, repo: repoName } = this.parseRepoIdentifier(project.repoFullName);
    const [branchName] = planRef.split(':');
    const logger = getLogger();

    if (!branchName) {
      throw new Error(`Invalid planRef format: ${planRef}`);
    }

    try {
      // Find and close any PRs from this branch
      const { data: prs } = await this.octokit.pulls.list({
        owner,
        repo: repoName,
        head: `${owner}:${branchName}`,
        state: 'open',
      });

      for (const pr of prs) {
        await this.octokit.pulls.update({
          owner,
          repo: repoName,
          pull_number: pr.number,
          state: 'closed',
        });

        logger.info('Closed plan PR', {
          owner,
          repo: repoName,
          prNumber: pr.number,
        });
      }

      // Delete the branch
      try {
        await this.octokit.git.deleteRef({
          owner,
          repo: repoName,
          ref: `heads/${branchName}`,
        });

        logger.info('Deleted plan branch', {
          owner,
          repo: repoName,
          branch: branchName,
        });
      } catch (deleteError: unknown) {
        // Branch might already be deleted
        if (deleteError && typeof deleteError === 'object' && 'status' in deleteError && deleteError.status !== 422) {
          throw deleteError;
        }
      }
    } catch (error) {
      logger.error('Failed to delete plan file', {
        owner,
        repo: repoName,
        planRef,
        error: getErrorMessage(error),
      });
      throw error;
    }
  }

  /**
   * Remove the plan file from the branch (without closing PR or deleting branch)
   * Used after plan execution to clean up the plan file
   */
  async removePlanFileOnly(
    project: VCSProjectConfig,
    planRef: string
  ): Promise<void> {
    const { owner, repo: repoName } = this.parseRepoIdentifier(project.repoFullName);
    const [branchName, filePath] = planRef.split(':');
    const logger = getLogger();

    if (!branchName || !filePath) {
      throw new Error(`Invalid planRef format: ${planRef}`);
    }

    try {
      // Get current file SHA
      const { data: currentFile } = await this.octokit.repos.getContent({
        owner,
        repo: repoName,
        path: filePath,
        ref: branchName,
      });

      if (Array.isArray(currentFile) || currentFile.type !== 'file') {
        throw new Error(`Plan path is not a file: ${filePath}`);
      }

      // Delete the file
      await this.octokit.repos.deleteFile({
        owner,
        repo: repoName,
        path: filePath,
        message: 'Remove plan file after implementation complete',
        sha: currentFile.sha,
        branch: branchName,
      });

      logger.info('Removed plan file from branch', {
        owner,
        repo: repoName,
        branch: branchName,
        filePath,
      });
    } catch (error: unknown) {
      // 404 means file doesn't exist - that's fine
      if (error && typeof error === 'object' && 'status' in error && error.status === 404) {
        logger.debug('Plan file already removed', {
          owner,
          repo: repoName,
          planRef,
        });
        return;
      }

      logger.warn('Failed to remove plan file', {
        owner,
        repo: repoName,
        planRef,
        error: getErrorMessage(error),
      });
      throw error;
    }
  }

  /**
   * Find a plan file on a branch
   * Searches for PLAN-*.md files in the .ai-bug-fixer/plans/ directory
   */
  async findPlanFile(
    project: VCSProjectConfig,
    branchName: string
  ): Promise<string | null> {
    const { owner, repo: repoName } = this.parseRepoIdentifier(project.repoFullName);
    const planDirectory = '.ai-bug-fixer/plans';
    const logger = getLogger();

    try {
      // List contents of the plans directory on the branch
      const { data } = await this.octokit.repos.getContent({
        owner,
        repo: repoName,
        path: planDirectory,
        ref: branchName,
      });

      // Check if it's a directory listing
      if (!Array.isArray(data)) {
        logger.debug('Plan directory is not a directory', {
          owner,
          repo: repoName,
          branch: branchName,
          path: planDirectory,
        });
        return null;
      }

      // Find a PLAN-*.md file
      const planFile = data.find(
        (item) => item.type === 'file' && item.name.startsWith('PLAN-') && item.name.endsWith('.md')
      );

      if (planFile) {
        const planRef = `${branchName}:${planFile.path}`;
        logger.info('Found existing plan file', {
          owner,
          repo: repoName,
          branch: branchName,
          planRef,
        });
        return planRef;
      }

      logger.debug('No plan file found in directory', {
        owner,
        repo: repoName,
        branch: branchName,
        path: planDirectory,
        files: data.map((f) => f.name),
      });
      return null;
    } catch (error: unknown) {
      // 404 means the directory doesn't exist - that's fine
      if (error && typeof error === 'object' && 'status' in error && error.status === 404) {
        logger.debug('Plan directory does not exist', {
          owner,
          repo: repoName,
          branch: branchName,
          path: planDirectory,
        });
        return null;
      }

      logger.warn('Failed to find plan file', {
        owner,
        repo: repoName,
        branch: branchName,
        error: getErrorMessage(error),
      });
      return null;
    }
  }

  /**
   * Get pull request info (branch, base, etc.)
   */
  async getPullRequestInfo(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<{ head: { ref: string; sha: string }; base: { ref: string }; state: string } | null> {
    const logger = getLogger();
    try {
      const { data: pr } = await this.octokit.pulls.get({
        owner,
        repo,
        pull_number: prNumber,
      });

      return {
        head: {
          ref: pr.head.ref,
          sha: pr.head.sha,
        },
        base: {
          ref: pr.base.ref,
        },
        state: pr.state,
      };
    } catch (error) {
      logger.warn('Failed to get PR info', {
        owner,
        repo,
        prNumber,
        error: getErrorMessage(error),
      });
      return null;
    }
  }

  /**
   * Parse repository identifier into owner and repo
   */
  private parseRepoIdentifier(repository: string): { owner: string; repo: string } {
    const parts = repository.split('/');
    if (parts.length !== 2) {
      throw new Error(`Invalid repository identifier: ${repository}`);
    }
    return { owner: parts[0], repo: parts[1] };
  }

  /**
   * Get the secrets required by this VCS plugin
   * Note: GitHub uses GitHub App authentication - no personal access token needed
   */
  getRequiredSecrets(): SecretRequirement[] {
    return [];
  }
}
