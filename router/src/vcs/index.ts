import { VCSPlugin } from './base';
import { GitHubVCS } from './github';
import { getSecret } from '../secrets';
import { registerPRProvider, getGitHubPRProvider } from '../pr';
import * as githubApp from '../github/app-service';

/**
 * Get GitHub webhook secret for a project (or global default)
 */
export async function getGitHubWebhookSecret(projectId?: string): Promise<string | null> {
  return getSecret('github', 'webhook_secret', projectId);
}

/**
 * Get a GitHub VCS instance for a project
 * Uses GitHub App authentication (requires app to be configured and installed)
 */
export async function getGitHubVCS(projectId: string): Promise<GitHubVCS | null> {
  // Use GitHub App authentication
  const octokit = await githubApp.getOctokit(projectId);
  if (!octokit) {
    return null;
  }
  return new GitHubVCS(octokit);
}

/**
 * Check if GitHub is available for a project
 */
export async function isGitHubAvailable(projectId: string): Promise<boolean> {
  const appConfigured = await githubApp.isAppConfigured();
  if (!appConfigured) return false;

  const hasInstall = await githubApp.hasInstallation(projectId);
  return hasInstall;
}

/**
 * Initialize VCS plugins
 */
export async function initializeVCS(): Promise<void> {
  // Check if GitHub App is configured
  const appStatus = await githubApp.getAppStatus();
  if (appStatus.configured) {
    console.log(`✓ GitHub App configured: ${appStatus.appName}`);
  } else {
    console.log('⚠ GitHub App not configured - set up via /settings');
  }

  // Register GitHub PR provider (checks installation at runtime)
  registerPRProvider(getGitHubPRProvider());
  console.log('✓ GitHub PR provider registered');

  // Future: GitLab, Bitbucket, etc.
}

/**
 * Get a GitHub token for a project (for git clone operations)
 * Returns an installation access token from the GitHub App
 */
export async function getGitHubToken(projectId: string): Promise<string | null> {
  const credentials = await githubApp.getAppCredentials();
  if (!credentials) return null;

  const installation = await githubApp.getInstallation(projectId);
  if (!installation) return null;

  // Get Octokit which will have a valid token
  const octokit = await githubApp.getOctokit(projectId);
  if (!octokit) return null;

  // Extract the token from Octokit's auth
  // The token is cached by the app service
  const auth = await octokit.auth() as { token: string };
  return auth.token;
}

/**
 * Get a VCS plugin for a specific project
 * Creates a new instance with project-specific credentials
 */
export async function getVCSForProject(
  vcsType: 'github' | 'gitlab' | 'bitbucket' | 'self-hosted',
  projectId: string
): Promise<VCSPlugin | null> {
  switch (vcsType) {
    case 'github':
      return getGitHubVCS(projectId);
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
export { getInstallationStatus as getGitHubInstallationStatus } from '../github/app-service';
