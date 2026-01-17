/**
 * GitHub App Service
 *
 * Manages GitHub App authentication for the system.
 * Provides Octokit instances authenticated as the GitHub App installation.
 *
 * Setup flow:
 * 1. Admin clicks "Create GitHub App" → redirected to GitHub with manifest
 * 2. GitHub creates app → redirects back with code
 * 3. We exchange code for credentials (app_id, client_id, client_secret, pem)
 * 4. Credentials stored encrypted in database
 *
 * Per-project flow:
 * 1. User clicks "Connect to GitHub" → redirected to GitHub OAuth
 * 2. User installs/authorizes app on their repo
 * 3. GitHub redirects back with installation_id
 * 4. Installation ID stored for that project
 *
 * Runtime:
 * 1. Plugin requests Octokit for a project
 * 2. Service generates installation token (cached, 1hr TTL)
 * 3. Returns configured Octokit instance
 */

import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';
import * as settingsRepo from '../db/repositories/settings';
import { logger } from '../logger';

// Storage keys
const APP_CREDENTIALS_KEY = 'github:app:credentials';
const INSTALLATION_KEY_PREFIX = 'github:app:installation:';

/**
 * GitHub App credentials returned from manifest flow
 */
export interface GitHubAppCredentials {
  appId: number;
  clientId: string;
  clientSecret: string;
  pem: string;
  webhookSecret?: string;
  appName: string;
  appSlug: string;
  htmlUrl: string;
}

/**
 * Installation info for a project
 */
export interface GitHubInstallation {
  installationId: number;
  accountLogin: string;
  accountType: 'User' | 'Organization';
  repositorySelection: 'all' | 'selected';
  installedAt: string;
}

/**
 * Token cache entry
 */
interface TokenCache {
  token: string;
  expiresAt: number;
}

// In-memory token cache (tokens are short-lived, no need to persist)
const tokenCache = new Map<number, TokenCache>();

// Token refresh buffer (refresh 5 min before expiry)
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

/**
 * Get the base URL for this application
 * Used for OAuth callbacks
 */
export function getBaseUrl(): string {
  return process.env.APP_URL || process.env.NEXTAUTH_URL || 'http://localhost:3000';
}

/**
 * Generate the GitHub App manifest for creation
 * https://docs.github.com/en/apps/creating-github-apps/setting-up-a-github-app/creating-a-github-app-from-a-manifest
 */
export function generateAppManifest(baseUrl: string): object {
  return {
    name: process.env.GITHUB_APP_NAME || 'AI Bug Fixer',
    url: baseUrl,
    hook_attributes: {
      url: `${baseUrl}/api/webhooks/github-app`,
      active: true,
    },
    redirect_url: `${baseUrl}/api/github/app/callback`,
    callback_urls: [`${baseUrl}/api/github/install/callback`],
    setup_url: `${baseUrl}/api/github/install/setup`,
    public: false,
    default_permissions: {
      // Repository permissions
      contents: 'write', // Read/write repo contents (for creating branches, commits)
      pull_requests: 'write', // Create and manage PRs
      issues: 'write', // Read/write issues and comments
      metadata: 'read', // Required for all apps
      // Optional: for CI status updates
      statuses: 'write',
      checks: 'write',
    },
    default_events: [
      'issues',
      'issue_comment',
      'pull_request',
      'pull_request_review',
      'pull_request_review_comment',
    ],
  };
}

/**
 * Store GitHub App credentials (from manifest flow)
 */
export async function storeAppCredentials(credentials: GitHubAppCredentials): Promise<void> {
  await settingsRepo.set(APP_CREDENTIALS_KEY, JSON.stringify(credentials), {
    encrypted: true,
    description: 'GitHub App credentials',
    category: 'github',
  });
  logger.info('Stored GitHub App credentials', {
    appId: credentials.appId,
    appSlug: credentials.appSlug,
  });
}

/**
 * Get GitHub App credentials
 */
export async function getAppCredentials(): Promise<GitHubAppCredentials | null> {
  const stored = await settingsRepo.getDecrypted(APP_CREDENTIALS_KEY);
  if (!stored) return null;

  try {
    return JSON.parse(stored) as GitHubAppCredentials;
  } catch {
    logger.error('Failed to parse stored GitHub App credentials');
    return null;
  }
}

/**
 * Check if GitHub App is configured
 */
export async function isAppConfigured(): Promise<boolean> {
  const credentials = await getAppCredentials();
  return credentials !== null;
}

/**
 * Delete GitHub App credentials
 */
export async function deleteAppCredentials(): Promise<void> {
  await settingsRepo.remove(APP_CREDENTIALS_KEY);
  tokenCache.clear();
  logger.info('Deleted GitHub App credentials');
}

/**
 * Store installation for a project
 */
export async function storeInstallation(
  projectId: string,
  installation: GitHubInstallation
): Promise<void> {
  const key = `${INSTALLATION_KEY_PREFIX}${projectId}`;
  await settingsRepo.set(key, JSON.stringify(installation), {
    encrypted: true,
    description: `GitHub installation for project ${projectId}`,
    category: 'github',
  });
  logger.info('Stored GitHub installation for project', {
    projectId,
    installationId: installation.installationId,
    account: installation.accountLogin,
  });
}

/**
 * Get installation for a project
 */
export async function getInstallation(projectId: string): Promise<GitHubInstallation | null> {
  const key = `${INSTALLATION_KEY_PREFIX}${projectId}`;
  const stored = await settingsRepo.getDecrypted(key);
  if (!stored) return null;

  try {
    return JSON.parse(stored) as GitHubInstallation;
  } catch {
    logger.error('Failed to parse stored GitHub installation', { projectId });
    return null;
  }
}

/**
 * Delete installation for a project
 */
export async function deleteInstallation(projectId: string): Promise<void> {
  const key = `${INSTALLATION_KEY_PREFIX}${projectId}`;
  const installation = await getInstallation(projectId);
  if (installation) {
    tokenCache.delete(installation.installationId);
  }
  await settingsRepo.remove(key);
  logger.info('Deleted GitHub installation for project', { projectId });
}

/**
 * Check if a project has a GitHub installation
 */
export async function hasInstallation(projectId: string): Promise<boolean> {
  const installation = await getInstallation(projectId);
  return installation !== null;
}

/**
 * Get an installation access token (cached)
 */
async function getInstallationToken(
  credentials: GitHubAppCredentials,
  installationId: number
): Promise<string> {
  // Check cache
  const cached = tokenCache.get(installationId);
  if (cached && cached.expiresAt > Date.now() + TOKEN_REFRESH_BUFFER_MS) {
    return cached.token;
  }

  // Generate new token
  const auth = createAppAuth({
    appId: credentials.appId,
    privateKey: credentials.pem,
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
  });

  const { token, expiresAt } = await auth({
    type: 'installation',
    installationId,
  });

  // Cache it
  tokenCache.set(installationId, {
    token,
    expiresAt: new Date(expiresAt).getTime(),
  });

  logger.debug('Generated new installation token', {
    installationId,
    expiresAt,
  });

  return token;
}

/**
 * Get an Octokit instance authenticated as the app installation for a project
 * This is the main entry point for plugins to get GitHub access
 */
export async function getOctokit(projectId: string): Promise<Octokit | null> {
  const credentials = await getAppCredentials();
  if (!credentials) {
    logger.debug('GitHub App not configured, cannot get Octokit', { projectId });
    return null;
  }

  const installation = await getInstallation(projectId);
  if (!installation) {
    logger.debug('No GitHub installation for project', { projectId });
    return null;
  }

  const token = await getInstallationToken(credentials, installation.installationId);

  return new Octokit({ auth: token });
}

/**
 * Get an Octokit instance authenticated as the app itself (not an installation)
 * Used for app-level operations like listing installations
 */
export async function getAppOctokit(): Promise<Octokit | null> {
  const credentials = await getAppCredentials();
  if (!credentials) {
    return null;
  }

  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: credentials.appId,
      privateKey: credentials.pem,
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
    },
  });
}

/**
 * Exchange a manifest code for app credentials
 * Called after GitHub redirects back from app creation
 */
export async function exchangeManifestCode(code: string): Promise<GitHubAppCredentials> {
  const response = await fetch(
    `https://api.github.com/app-manifests/${code}/conversions`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to exchange manifest code: ${error}`);
  }

  const data = await response.json() as {
    id: number;
    client_id: string;
    client_secret: string;
    pem: string;
    webhook_secret: string;
    name: string;
    slug: string;
    html_url: string;
  };

  return {
    appId: data.id,
    clientId: data.client_id,
    clientSecret: data.client_secret,
    pem: data.pem,
    webhookSecret: data.webhook_secret,
    appName: data.name,
    appSlug: data.slug,
    htmlUrl: data.html_url,
  };
}

/**
 * Get the OAuth authorization URL for installing the app on a repo/org
 */
export async function getInstallUrl(projectId: string, repoFullName?: string): Promise<string | null> {
  const credentials = await getAppCredentials();
  if (!credentials) {
    return null;
  }

  // State parameter to pass projectId through OAuth flow
  const state = Buffer.from(JSON.stringify({ projectId, repoFullName })).toString('base64url');

  // Direct user to install the app
  // Using the app's installation URL which handles both new installs and authorizations
  return `https://github.com/apps/${credentials.appSlug}/installations/new?state=${state}`;
}

/**
 * Get status of GitHub App configuration
 */
export async function getAppStatus(): Promise<{
  configured: boolean;
  appName?: string;
  appSlug?: string;
  htmlUrl?: string;
}> {
  const credentials = await getAppCredentials();
  if (!credentials) {
    return { configured: false };
  }

  return {
    configured: true,
    appName: credentials.appName,
    appSlug: credentials.appSlug,
    htmlUrl: credentials.htmlUrl,
  };
}

/**
 * Get status of GitHub installation for a project
 */
export async function getInstallationStatus(projectId: string): Promise<{
  installed: boolean;
  accountLogin?: string;
  accountType?: string;
  installedAt?: string;
}> {
  const installation = await getInstallation(projectId);
  if (!installation) {
    return { installed: false };
  }

  return {
    installed: true,
    accountLogin: installation.accountLogin,
    accountType: installation.accountType,
    installedAt: installation.installedAt,
  };
}
