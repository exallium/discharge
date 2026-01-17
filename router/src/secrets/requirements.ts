/**
 * Secret Requirements Aggregation
 *
 * Aggregates secret requirements from VCS, trigger, and runner plugins.
 * Shared secrets (same ID used by multiple plugins) appear once with "usedBy" metadata.
 */

import { SecretRequirement } from '../triggers/base';
import { ProjectConfig } from '../config/projects';
import { getTriggerById } from '../triggers';
import { getRunner, getAllRunners } from '../runner/base';

/**
 * Extended secret requirement with usage information
 */
export interface AggregatedSecretRequirement extends SecretRequirement {
  /** Which plugins use this secret */
  usedBy: string[];
}

/**
 * Get runner secret requirements
 * Fetches requirements from the runner plugin based on project config
 * If no runner type is specified, returns secrets from all registered runners
 */
function getRunnerSecretRequirements(project: ProjectConfig): SecretRequirement[] {
  const runnerId = project.runner?.type;

  if (runnerId) {
    // Specific runner configured - get its secrets
    const runner = getRunner(runnerId);
    if (runner) {
      return runner.getRequiredSecrets();
    }
    return [];
  }

  // No specific runner - return secrets from all registered runners
  const allRunners = getAllRunners();
  const secrets: SecretRequirement[] = [];
  const seenIds = new Set<string>();

  for (const runner of allRunners) {
    for (const secret of runner.getRequiredSecrets()) {
      if (!seenIds.has(secret.id)) {
        secrets.push(secret);
        seenIds.add(secret.id);
      }
    }
  }

  return secrets;
}

/**
 * Get VCS secret requirements by type
 * This is a static mapping since VCS secrets are known at compile time
 * Note: GitHub uses GitHub App authentication, so no token secret is required
 */
function getVCSSecretRequirements(vcsType: string): SecretRequirement[] {
  switch (vcsType) {
    case 'github':
      // GitHub uses GitHub App authentication - no personal access token needed
      return [];
    case 'gitlab':
      return [
        {
          id: 'gitlab_token',
          label: 'GitLab Token',
          description: 'Personal access token for GitLab API',
          required: true,
          plugin: 'gitlab',
          key: 'token',
        },
      ];
    case 'bitbucket':
      return [
        {
          id: 'bitbucket_token',
          label: 'Bitbucket Token',
          description: 'App password for Bitbucket API',
          required: true,
          plugin: 'bitbucket',
          key: 'token',
        },
      ];
    default:
      return [];
  }
}

/**
 * Determine which triggers are enabled for a project
 */
function getEnabledTriggerIds(project: ProjectConfig): string[] {
  const enabled: string[] = [];

  // Check each trigger type
  if (project.triggers.sentry?.enabled) {
    enabled.push('sentry');
  }

  if (project.triggers.github?.issues) {
    enabled.push('github-issues');
  }

  if (project.triggers.circleci?.enabled) {
    enabled.push('circleci');
  }

  return enabled;
}

/**
 * Get aggregated secret requirements for a project
 *
 * Combines secrets from:
 * - VCS plugin (based on project.vcs.type)
 * - Enabled trigger plugins
 *
 * Shared secrets (same ID) are deduplicated and show all consumers.
 *
 * @param project - Project configuration
 * @returns Aggregated secret requirements with usage information
 */
export function getProjectSecretRequirements(
  project: ProjectConfig
): AggregatedSecretRequirement[] {
  // Map of secret ID -> { requirement, usedBy[] }
  const seen = new Map<string, { requirement: SecretRequirement; usedBy: string[] }>();

  // 1. Runner requirements (based on project.runner.type)
  const runnerSecrets = getRunnerSecretRequirements(project);
  for (const req of runnerSecrets) {
    seen.set(req.id, { requirement: req, usedBy: ['runner'] });
  }

  // 2. VCS plugin requirements (always included based on project.vcs.type)
  const vcsSecrets = getVCSSecretRequirements(project.vcs.type);
  for (const req of vcsSecrets) {
    seen.set(req.id, { requirement: req, usedBy: ['vcs'] });
  }

  // 3. Enabled trigger requirements
  const enabledTriggers = getEnabledTriggerIds(project);
  for (const triggerId of enabledTriggers) {
    const trigger = getTriggerById(triggerId);
    if (!trigger) continue;

    const secrets = trigger.getRequiredSecrets();
    for (const req of secrets) {
      if (seen.has(req.id)) {
        // Secret already registered - add this trigger to usedBy
        seen.get(req.id)!.usedBy.push(triggerId);
      } else {
        // New secret
        seen.set(req.id, { requirement: req, usedBy: [triggerId] });
      }
    }
  }

  // Convert to array with usedBy included
  return Array.from(seen.values()).map(({ requirement, usedBy }) => ({
    ...requirement,
    usedBy,
  }));
}

/**
 * Get all available secret requirements across all plugins
 * Useful for displaying documentation or configuration reference
 */
export function getAllSecretRequirements(): AggregatedSecretRequirement[] {
  const seen = new Map<string, { requirement: SecretRequirement; usedBy: string[] }>();

  // All registered runners
  const runners = getAllRunners();
  for (const runner of runners) {
    const secrets = runner.getRequiredSecrets();
    for (const req of secrets) {
      if (seen.has(req.id)) {
        seen.get(req.id)!.usedBy.push(`runner:${runner.id}`);
      } else {
        seen.set(req.id, { requirement: req, usedBy: [`runner:${runner.id}`] });
      }
    }
  }

  // All VCS types
  const vcsTypes = ['github', 'gitlab', 'bitbucket'];
  for (const vcsType of vcsTypes) {
    const vcsSecrets = getVCSSecretRequirements(vcsType);
    for (const req of vcsSecrets) {
      if (!seen.has(req.id)) {
        seen.set(req.id, { requirement: req, usedBy: [`vcs:${vcsType}`] });
      }
    }
  }

  // All registered triggers
  const triggerIds = ['sentry', 'github-issues', 'circleci'];
  for (const triggerId of triggerIds) {
    const trigger = getTriggerById(triggerId);
    if (!trigger) continue;

    const secrets = trigger.getRequiredSecrets();
    for (const req of secrets) {
      if (seen.has(req.id)) {
        seen.get(req.id)!.usedBy.push(triggerId);
      } else {
        seen.set(req.id, { requirement: req, usedBy: [triggerId] });
      }
    }
  }

  return Array.from(seen.values()).map(({ requirement, usedBy }) => ({
    ...requirement,
    usedBy,
  }));
}

/**
 * Check if a secret is shared between multiple plugins
 */
export function isSharedSecret(secretId: string, project: ProjectConfig): boolean {
  const requirements = getProjectSecretRequirements(project);
  const secret = requirements.find((r) => r.id === secretId);
  return secret ? secret.usedBy.length > 1 : false;
}

/**
 * Format usedBy array for display
 * e.g., ['vcs', 'github-issues'] -> 'VCS, GitHub Issues'
 */
export function formatUsedBy(usedBy: string[]): string {
  const labels: Record<string, string> = {
    runner: 'Claude Code Runner',
    vcs: 'VCS',
    'github-issues': 'GitHub Issues',
    sentry: 'Sentry',
    circleci: 'CircleCI',
  };

  return usedBy.map((id) => labels[id] || id).join(', ');
}
