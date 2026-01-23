/**
 * VCS Plugin Registry
 *
 * This module bridges between the legacy VCS system and the new service-based architecture.
 * VCS lookups now go through the service registry.
 */

import { registry } from '@discharge/service-locator';
import type { VCSPlugin } from '@discharge/service-sdk';
import { GitHubVCS } from '@discharge/service-github';
import { getSecret } from '../secrets';
import { registerPRProvider, getGitHubPRProvider } from '../pr';
import * as githubApp from '../github/app-service';

// Re-export types from SDK for backward compatibility
export type { VCSPlugin } from '@discharge/service-sdk';
export { formatPRBody } from '@discharge/service-sdk';

// Re-export VCS types from SDK
export type { VCSProjectConfig, PlanFileResult, PullRequest } from '@discharge/service-sdk';

// Re-export GitHubVCS from service-github for consumers that need it
export { GitHubVCS } from '@discharge/service-github';

/**
 * Get GitHub webhook secret for a project (or global default)
 * Note: When using GitHub App, the webhook secret is stored in app credentials
 */
export async function getGitHubWebhookSecret(projectId?: string): Promise<string | null> {
  // First check if we have app credentials with a webhook secret
  const appCredentials = await githubApp.getAppCredentials();
  if (appCredentials?.webhookSecret) {
    return appCredentials.webhookSecret;
  }

  // Fall back to project-specific or global secret
  return getSecret('github', 'webhook_secret', projectId);
}

/**
 * Get a GitHub VCS instance for a repository
 * Uses GitHub App authentication (requires app to be configured and installed)
 */
export async function getGitHubVCS(repoFullName: string): Promise<GitHubVCS | null> {
  // Use GitHub App authentication
  const octokit = await githubApp.getOctokitForRepo(repoFullName);
  if (!octokit) {
    return null;
  }
  return new GitHubVCS(octokit);
}

/**
 * Check if GitHub is available for a repository
 */
export async function isGitHubAvailable(repoFullName: string): Promise<boolean> {
  const appConfigured = await githubApp.isAppConfigured();
  if (!appConfigured) return false;

  const installation = await githubApp.getInstallationForRepo(repoFullName);
  return installation !== null;
}

/**
 * Initialize VCS plugins
 */
export async function initializeVCS(): Promise<void> {
  // Check if GitHub App is configured
  const appStatus = await githubApp.getAppStatus();
  if (appStatus.configured) {
    console.log(`✓ GitHub App configured: ${appStatus.appName}`);
    if (appStatus.installations && appStatus.installations.length > 0) {
      console.log(`  Connected accounts: ${appStatus.installations.map(i => i.accountLogin).join(', ')}`);
    } else {
      console.log('  ⚠ No GitHub accounts connected');
    }
  } else {
    console.log('⚠ GitHub App not configured - set up via /settings');
  }

  // Register GitHub PR provider (checks installation at runtime)
  registerPRProvider(getGitHubPRProvider());
  console.log('✓ GitHub PR provider registered');

  // Future: GitLab, Bitbucket, etc.
}

/**
 * Get a GitHub token for a repository (for git clone operations and API calls)
 * Returns an installation access token from the GitHub App
 */
export async function getGitHubToken(repoFullName: string): Promise<string | null> {
  const credentials = await githubApp.getAppCredentials();
  if (!credentials) return null;

  const installation = await githubApp.getInstallationForRepo(repoFullName);
  if (!installation) return null;

  // Get Octokit which will have a valid token
  const octokit = await githubApp.getOctokitForInstallation(installation.installationId);
  if (!octokit) return null;

  // Extract the token from Octokit's auth
  // The token is cached by the app service
  const auth = await octokit.auth() as { token: string };
  return auth.token;
}

/**
 * Get a VCS plugin for a specific project
 * Uses the service registry for lookups, falling back to direct methods
 */
export async function getVCSForProject(
  vcsType: 'github' | 'gitlab' | 'bitbucket' | 'self-hosted',
  repoFullName: string
): Promise<VCSPlugin | null> {
  // First try the service registry
  const fromRegistry = await registry.getVCSForRepo(repoFullName);
  if (fromRegistry) {
    return fromRegistry;
  }

  // Fall back to direct methods for backward compatibility
  switch (vcsType) {
    case 'github':
      return getGitHubVCS(repoFullName);
    // Future: case 'gitlab': return getGitLabVCS(projectId);
    default:
      return null;
  }
}

/**
 * Re-export GitHub App service functions for convenience
 */
export { isAppConfigured as isGitHubAppConfigured } from '../github/app-service';
export { getAppStatus as getGitHubAppStatus } from '../github/app-service';
export { getInstallationsStatus as getGitHubInstallationsStatus } from '../github/app-service';
