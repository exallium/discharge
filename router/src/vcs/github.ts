import { Octokit } from '@octokit/rest';
import { VCSPlugin, PullRequest } from './base';

/**
 * GitHub VCS plugin using Octokit
 * Supports Personal Access Tokens and GitHub Apps
 */
export class GitHubVCS implements VCSPlugin {
  id = 'github';
  type = 'github' as const;

  private octokit: Octokit;

  constructor(token: string) {
    this.octokit = new Octokit({ auth: token });
  }

  async createPullRequest(
    owner: string,
    repo: string,
    head: string,
    base: string,
    title: string,
    body: string
  ): Promise<PullRequest> {
    console.log(`[GitHubVCS] Creating PR: ${owner}/${repo} ${head} -> ${base}`);

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
    } catch (error: any) {
      return {
        valid: false,
        error: error.message || 'GitHub authentication failed',
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
}
