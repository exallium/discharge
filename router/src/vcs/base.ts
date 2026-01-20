import { AnalysisResult, SecretRequirement } from '../triggers/base';

/**
 * Minimal project info needed for VCS operations
 * Compatible with both config/projects.ProjectConfig and db/repositories/projects.ProjectConfig
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

  /**
   * Whether this VCS plugin supports plan file operations
   */
  supportsPlanFiles?: boolean;

  /**
   * Create a plan file in the repository
   * Implementation varies by VCS (branch + PR, direct file, etc.)
   *
   * @param project - Project configuration
   * @param content - Plan file content (markdown)
   * @param filePath - Path for the plan file
   * @param issueNumber - Associated issue/ticket number
   * @returns Plan reference and metadata
   */
  createPlanFile?(
    project: VCSProjectConfig,
    content: string,
    filePath: string,
    issueNumber?: number | string
  ): Promise<PlanFileResult>;

  /**
   * Update an existing plan file
   *
   * @param project - Project configuration
   * @param planRef - VCS-specific reference to the plan
   * @param content - Updated plan content
   */
  updatePlanFile?(
    project: VCSProjectConfig,
    planRef: string,
    content: string
  ): Promise<void>;

  /**
   * Get plan file content
   *
   * @param project - Project configuration
   * @param planRef - VCS-specific reference to the plan
   * @returns Plan file content or null if not found
   */
  getPlanFile?(
    project: VCSProjectConfig,
    planRef: string
  ): Promise<string | null>;

  /**
   * Delete/close a plan file
   * May close a PR, delete a branch, or remove the file
   *
   * @param project - Project configuration
   * @param planRef - VCS-specific reference to the plan
   */
  deletePlanFile?(
    project: VCSProjectConfig,
    planRef: string
  ): Promise<void>;

  /**
   * Find a plan file on a branch
   * Used when responding to PR reviews to find the existing plan
   *
   * @param project - Project configuration
   * @param branchName - Branch to search on
   * @returns Plan reference (branchName:filePath) or null if not found
   */
  findPlanFile?(
    project: VCSProjectConfig,
    branchName: string
  ): Promise<string | null>;

  // ========================================
  // Secret Requirements
  // ========================================

  /**
   * Get the secrets required by this VCS plugin
   * Used to aggregate and display secrets in the UI
   *
   * @returns Array of secret requirements
   */
  getRequiredSecrets(): SecretRequirement[];
}

/**
 * Extract issue number from a GitHub issue URL
 */
function extractIssueNumber(url: string): number | null {
  const match = url.match(/\/issues\/(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Investigation context for inclusion in PR body
 */
interface InvestigationContext {
  rootCause: string;
  filesInvolved: string[];
  suggestedApproach: string;
  summary?: string;
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
  const issueNumber = extractIssueNumber(sourceLink);
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
