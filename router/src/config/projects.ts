/**
 * Project configuration for repositories that can be auto-fixed
 *
 * This module provides the interface for project configuration and
 * functions to query projects from the database.
 *
 * Note: Functions are async as they query the PostgreSQL database.
 */

import { projectsRepo } from '../db/repositories';

/**
 * Project configuration interface
 */
export interface ProjectConfig {
  id: string;
  repo: string;                  // Git URL (e.g., git@github.com:owner/repo.git)
  repoFullName: string;          // owner/repo format
  branch: string;                // Base branch to create fixes from

  // VCS configuration
  vcs: {
    type: 'github' | 'gitlab' | 'bitbucket' | 'self-hosted';
    owner: string;               // Repository owner/organization/namespace
    repo: string;                // Repository name/project
    reviewers?: string[];        // Auto-request these reviewers on PRs
    labels?: string[];           // Auto-add these labels to PRs
  };

  // Runner configuration
  runner?: {
    type?: string;               // Runner plugin ID (default: 'claude-code')
    timeout?: number;            // Execution timeout in ms (default: 600000)
    env?: Record<string, string>; // Additional environment variables
  };

  triggers: {
    sentry?: {
      /** Sentry project slug - will be synced from .discharge.json integrations.sentry.project */
      projectSlug: string;
      enabled: boolean;
      /** Sentry organization slug - synced from .discharge.json integrations.sentry.organization */
      organization?: string;
      /** Custom Sentry instance URL for self-hosted - synced from .discharge.json integrations.sentry.instanceUrl */
      instanceUrl?: string;
    };
    github?: {
      issues: boolean;
      labels?: string[];           // Only trigger on issues with these labels
      requireLabel?: boolean;      // If true, issue MUST have one of the specified labels
      commentTrigger?: string;     // Trigger via comment (e.g., "/claude fix")
      allowedUsers?: string[];     // GitHub usernames allowed to trigger via comment
    };
    circleci?: {
      projectSlug: string;
      enabled: boolean;
    };
    [key: string]: TriggerSourceConfig | undefined;  // Allow custom source configs
  };
  constraints?: {
    maxAttemptsPerDay?: number;
    allowedPaths?: string[];     // Restrict Claude to these directories
    excludedPaths?: string[];    // Never touch these files/dirs
  };

  // Conversation mode configuration
  conversation?: {
    enabled?: boolean;             // Enable conversational feedback loop
    autoExecuteThreshold?: number; // Confidence threshold for auto-execute (0.0-1.0)
    maxIterations?: number;        // Max feedback iterations per conversation
    planDirectory?: string;        // Directory for plan files in target repos
    routingTags?: {
      plan?: string;               // Tag to trigger plan-review mode (e.g., 'ai:plan')
      auto?: string;               // Tag to trigger auto-execute mode (e.g., 'ai:auto')
      assist?: string;             // Tag to trigger assist-only mode (e.g., 'ai:assist')
    };
  };
}

/**
 * Base trigger source configuration
 * Note: Some triggers use 'enabled', others use different properties (e.g., github uses 'issues')
 */
export interface TriggerSourceConfig {
  enabled?: boolean;
  [key: string]: unknown;
}

/**
 * @deprecated Use findProjectById instead. This array is no longer used.
 * Kept for backward compatibility with tests.
 */
export const projects: ProjectConfig[] = [];

/**
 * Find a project by its ID
 */
export async function findProjectById(id: string): Promise<ProjectConfig | undefined> {
  const project = await projectsRepo.findById(id);
  return project ? toProjectConfig(project) : undefined;
}

/**
 * Find a project by repository full name (owner/repo)
 */
export async function findProjectByRepo(repoFullName: string): Promise<ProjectConfig | undefined> {
  const project = await projectsRepo.findByRepo(repoFullName);
  return project ? toProjectConfig(project) : undefined;
}

/**
 * Find projects by source configuration
 */
export async function findProjectsBySource(
  sourceType: string,
  matcher: (config: TriggerSourceConfig) => boolean
): Promise<ProjectConfig[]> {
  const dbProjects = await projectsRepo.findBySource(sourceType, matcher);
  return dbProjects.map(toProjectConfig);
}

/**
 * Get all projects
 */
export async function getAllProjects(includeDisabled = false): Promise<ProjectConfig[]> {
  const dbProjects = await projectsRepo.findAll(includeDisabled);
  return dbProjects.map(toProjectConfig);
}

/**
 * Convert repository ProjectConfig to interface ProjectConfig
 * (They should be the same, but this ensures type compatibility)
 */
function toProjectConfig(repo: projectsRepo.ProjectConfig): ProjectConfig {
  return {
    id: repo.id,
    repo: repo.repo,
    repoFullName: repo.repoFullName,
    branch: repo.branch,
    vcs: repo.vcs,
    runner: repo.runner,
    triggers: repo.triggers as ProjectConfig['triggers'],
    constraints: repo.constraints,
    conversation: repo.conversation,
  };
}
