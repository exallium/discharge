/**
 * PR Provider Interface
 *
 * Abstracts pull request creation across different VCS platforms.
 * Allows deterministic PR creation logic without relying on AI decisions.
 */

import type { ProjectConfig } from '../config/projects';

/**
 * Options for creating a pull request
 */
export interface CreatePROptions {
  /** Project ID for credential lookup */
  projectId: string;
  /** Repository owner/organization */
  owner: string;
  /** Repository name */
  repo: string;
  /** Source branch (contains changes) */
  head: string;
  /** Target branch (where to merge) */
  base: string;
  /** PR title */
  title: string;
  /** PR body/description (markdown) */
  body: string;
}

/**
 * Options for generating compare URL
 */
export interface CompareOptions {
  /** Repository owner/organization */
  owner: string;
  /** Repository name */
  repo: string;
  /** Base branch */
  base: string;
  /** Head branch */
  head: string;
}

/**
 * Result of a PR creation attempt
 */
export interface PRResult {
  /** Whether PR creation succeeded */
  success: boolean;
  /** PR number if created */
  prNumber?: number;
  /** PR URL if created */
  prUrl?: string;
  /** Compare URL as fallback if PR creation failed */
  compareUrl?: string;
  /** Error message if creation failed */
  error?: string;
}

/**
 * PR Provider interface
 * Implemented by VCS plugins that can create PRs
 */
export interface PRProvider {
  /** Provider identifier */
  id: string;

  /**
   * Check if this provider can create PRs for the given project
   * Typically checks if credentials are configured
   *
   * @param project - Project configuration
   * @returns true if PRs can be created
   */
  canCreatePR(project: ProjectConfig): Promise<boolean>;

  /**
   * Create a pull request
   *
   * @param options - PR creation options
   * @returns Result with PR URL or error
   */
  createPullRequest(options: CreatePROptions): Promise<PRResult>;

  /**
   * Get compare URL for viewing changes
   * Used as fallback when PR creation fails
   *
   * @param options - Compare options
   * @returns Compare URL string
   */
  getCompareUrl(options: CompareOptions): string;
}
