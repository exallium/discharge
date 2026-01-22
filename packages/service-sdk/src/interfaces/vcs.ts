/**
 * VCS Plugin Interface
 *
 * Abstracts operations for different git hosting platforms (GitHub, GitLab, Bitbucket, etc.)
 * Used for creating PRs, managing plan files, and interacting with repositories.
 */

import type { AnalysisResult, SecretRequirement } from './trigger';
import type { InvestigationContext } from './runner';

// Re-export InvestigationContext for convenience
export type { InvestigationContext } from './runner';

/**
 * Minimal project info needed for VCS operations
 */
export interface VCSProjectConfig {
  repoFullName: string;
  branch: string;
  vcs: {
    type: 'github' | 'gitlab' | 'bitbucket' | 'self-hosted';
    owner: string;
    repo: string;
  };
}

/**
 * Result of creating a plan file
 */
export interface PlanFileResult {
  planRef: string;         // VCS-specific reference to the plan
  branch?: string;         // Branch containing the plan (if applicable)
  prNumber?: number;       // PR number (if plan is in a PR)
  url?: string;            // Web URL to view the plan
}

/**
 * Pull Request data
 */
export interface PullRequest {
  number: number;
  url: string;
  htmlUrl: string;
  title: string;
  body: string;
  head: string;
  base: string;
}

/**
 * VCS plugin interface
 * Abstracts operations for different git hosting platforms
 */
export interface VCSPlugin {
  /**
   * Plugin identification
   */
  id: string;
  type: 'github' | 'gitlab' | 'bitbucket' | 'self-hosted';

  /**
   * Create a pull request
   *
   * @param owner - Repository owner/organization
   * @param repo - Repository name
   * @param head - Source branch name
   * @param base - Target branch name
   * @param title - PR title
   * @param body - PR description (markdown)
   * @returns Created pull request
   */
  createPullRequest(
    owner: string,
    repo: string,
    head: string,
    base: string,
    title: string,
    body: string
  ): Promise<PullRequest>;

  /**
   * Get compare URL for a branch (used if PR creation fails)
   */
  getCompareUrl(
    owner: string,
    repo: string,
    base: string,
    head: string
  ): string;

  /**
   * Format repository identifier for this VCS
   * e.g., "owner/repo" for GitHub, "namespace/project" for GitLab
   */
  formatRepoIdentifier(owner: string, repo: string): string;

  /**
   * Validate VCS configuration/credentials
   */
  validate(): Promise<{ valid: boolean; error?: string }>;

  // ========================================
  // Plan File Operations (Optional)
  // ========================================

  /** Whether this VCS plugin supports plan file operations */
  supportsPlanFiles?: boolean;

  /**
   * Create a plan file in the repository
   * Implementation varies by VCS (branch + PR, direct file, etc.)
   */
  createPlanFile?(
    project: VCSProjectConfig,
    content: string,
    filePath: string,
    issueNumber?: number | string
  ): Promise<PlanFileResult>;

  /**
   * Update an existing plan file
   */
  updatePlanFile?(
    project: VCSProjectConfig,
    planRef: string,
    content: string
  ): Promise<void>;

  /**
   * Get plan file content
   */
  getPlanFile?(
    project: VCSProjectConfig,
    planRef: string
  ): Promise<string | null>;

  /**
   * Delete/close a plan file
   * May close a PR, delete a branch, or remove the file
   */
  deletePlanFile?(
    project: VCSProjectConfig,
    planRef: string
  ): Promise<void>;

  /**
   * Find a plan file on a branch
   * Used when responding to PR reviews to find the existing plan
   */
  findPlanFile?(
    project: VCSProjectConfig,
    branchName: string
  ): Promise<string | null>;

  // ========================================
  // Issue/PR Operations (Optional)
  // ========================================

  /**
   * Add labels to an issue or PR
   * Implementations can no-op if not supported
   */
  addLabels?(
    owner: string,
    repo: string,
    number: number,
    labels: string[]
  ): Promise<void>;

  /**
   * Request reviewers for a pull request
   * Implementations can no-op if not supported
   */
  requestReviewers?(
    owner: string,
    repo: string,
    prNumber: number,
    reviewers: string[]
  ): Promise<void>;

  /**
   * Get pull request info (branch, base, state)
   * Returns null if PR not found or not supported
   */
  getPullRequestInfo?(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<{
    head: string;        // Source branch name
    base: string;        // Target branch name
    state: 'open' | 'closed' | 'merged';
    title: string;
    body: string;
  } | null>;

  /**
   * Remove only the plan file, keeping the branch/PR open
   * Used after successful plan execution
   */
  removePlanFileOnly?(
    project: VCSProjectConfig,
    planRef: string
  ): Promise<void>;

  // ========================================
  // Secret Requirements
  // ========================================

  /**
   * Get the secrets required by this VCS plugin
   */
  getRequiredSecrets(): SecretRequirement[];
}

/**
 * Factory for creating VCS plugin instances with per-repo auth
 */
export interface VCSPluginFactory {
  /**
   * Get a VCS plugin instance for a specific repository
   * Returns null if the service doesn't have access to this repo
   */
  getForRepo(repoFullName: string): Promise<VCSPlugin | null>;

  /**
   * Check if this VCS service is available for a repository
   */
  isAvailable(repoFullName: string): Promise<boolean>;

  /**
   * Get the secrets required by this VCS service
   */
  getRequiredSecrets(): SecretRequirement[];
}

/**
 * Helper to format PR body from analysis
 */
export function formatPRBody(
  analysis: AnalysisResult,
  sourceLink: string,
  investigationContext?: InvestigationContext
): string {
  // Extract issue number for "Fixes #X" reference (enables auto-close and conversation linking)
  const issueMatch = sourceLink.match(/\/issues\/(\d+)/);
  const issueNumber = issueMatch ? parseInt(issueMatch[1], 10) : null;
  const fixesReference = issueNumber ? `Fixes #${issueNumber}` : '';

  // Build investigation section if context is available
  let investigationSection = '';
  if (investigationContext) {
    investigationSection = `
### Investigation Summary

${investigationContext.summary || investigationContext.rootCause}

**Suggested Approach:** ${investigationContext.suggestedApproach}

`;
  }

  return `
## Automated Fix

${fixesReference}

${sourceLink}
${investigationSection}
### Analysis

- **Root Cause:** ${analysis.rootCause}
- **Confidence:** ${analysis.confidence}
- **Complexity:** ${analysis.complexity}

### Changes

${analysis.proposedFix}

### Files Modified

${analysis.filesInvolved.map(f => `- \`${f}\``).join('\n')}

---
*This PR was automatically generated by AI Bug Fixer. Please review carefully before merging.*
  `.trim();
}
