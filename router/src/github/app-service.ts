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
const INSTALLATION_KEY_PREFIX = 'github:app:installation:account:';

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

// Word lists for generating unique app names
const ADJECTIVES = [
  'swift', 'clever', 'bright', 'quick', 'sharp',
  'keen', 'nimble', 'agile', 'smart', 'rapid',
  'stellar', 'cosmic', 'cyber', 'quantum', 'turbo',
  'hyper', 'mega', 'ultra', 'super', 'prime',
];

const NOUNS = [
  'falcon', 'phoenix', 'tiger', 'dragon', 'hawk',
  'wolf', 'panther', 'eagle', 'fox', 'lynx',
  'bolt', 'spark', 'pulse', 'wave', 'beam',
  'core', 'node', 'link', 'sync', 'flux',
];

/**
 * Generate a unique app name using combinatorial words
 */
function generateAppName(): string {
  const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const suffix = Math.floor(Math.random() * 1000);
  return `Discharge ${adjective}-${noun}-${suffix}`;
}

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
    name: process.env.GITHUB_APP_NAME || generateAppName(),
    url: baseUrl,
    hook_attributes: {
      url: `${baseUrl}/api/webhooks/github`,
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
  logger.debug('getAppCredentials lookup', { key: APP_CREDENTIALS_KEY, found: !!stored });
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
 * Delete GitHub App credentials and all installations
 */
export async function deleteAppCredentials(): Promise<void> {
  // First delete all installations (they're tied to this app)
  const installations = await getAllInstallations();
  for (const installation of installations) {
    await deleteInstallationByAccount(installation.accountLogin);
  }

  // Then delete the app credentials
  await settingsRepo.remove(APP_CREDENTIALS_KEY);
  tokenCache.clear();
  logger.info('Deleted GitHub App credentials and all installations');
}

/**
 * Store installation by account (not project)
 * This allows multiple projects to share the same installation
 */
export async function storeInstallation(
  accountLogin: string,
  installation: GitHubInstallation
): Promise<void> {
  const key = `${INSTALLATION_KEY_PREFIX}${accountLogin.toLowerCase()}`;
  await settingsRepo.set(key, JSON.stringify(installation), {
    encrypted: true,
    description: `GitHub installation for ${installation.accountType.toLowerCase()} ${accountLogin}`,
    category: 'github',
  });
  logger.info('Stored GitHub installation', {
    installationId: installation.installationId,
    account: installation.accountLogin,
    accountType: installation.accountType,
  });
}

/**
 * Get installation by account login
 */
export async function getInstallationByAccount(accountLogin: string): Promise<GitHubInstallation | null> {
  const key = `${INSTALLATION_KEY_PREFIX}${accountLogin.toLowerCase()}`;
  const stored = await settingsRepo.getDecrypted(key);
  if (!stored) return null;

  try {
    return JSON.parse(stored) as GitHubInstallation;
  } catch {
    logger.error('Failed to parse stored GitHub installation', { accountLogin });
    return null;
  }
}

/**
 * Get all stored installations
 */
export async function getAllInstallations(): Promise<GitHubInstallation[]> {
  // getByCategory returns masked values for encrypted settings,
  // so we just use it to get the keys, then decrypt each one
  const allSettings = await settingsRepo.getByCategory('github');
  const installations: GitHubInstallation[] = [];

  for (const setting of allSettings) {
    if (setting.key.startsWith(INSTALLATION_KEY_PREFIX)) {
      try {
        // Must use getDecrypted to get the actual value
        const decrypted = await settingsRepo.getDecrypted(setting.key);
        if (decrypted) {
          installations.push(JSON.parse(decrypted) as GitHubInstallation);
        }
      } catch (err) {
        logger.error('Failed to parse installation', { key: setting.key, error: err });
      }
    }
  }

  return installations;
}

/**
 * Delete installation by account
 */
export async function deleteInstallationByAccount(accountLogin: string): Promise<void> {
  const installation = await getInstallationByAccount(accountLogin);
  if (installation) {
    tokenCache.delete(installation.installationId);
  }
  const key = `${INSTALLATION_KEY_PREFIX}${accountLogin.toLowerCase()}`;
  await settingsRepo.remove(key);
  logger.info('Deleted GitHub installation', { accountLogin });
}

/**
 * Check if we have any GitHub installations
 */
export async function hasAnyInstallation(): Promise<boolean> {
  const installations = await getAllInstallations();
  return installations.length > 0;
}

/**
 * Get installation for a repository (finds the right account)
 */
export async function getInstallationForRepo(repoFullName: string): Promise<GitHubInstallation | null> {
  const [owner] = repoFullName.split('/');
  // First try the owner directly
  const installation = await getInstallationByAccount(owner);
  if (installation) return installation;

  // If not found, we might need to check all installations
  // (in case a user has access to an org repo through their personal installation)
  const allInstallations = await getAllInstallations();
  for (const inst of allInstallations) {
    // For now, return the first installation - could be improved to check repo access
    if (inst) return inst;
  }

  return null;
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
 * Get an Octokit instance authenticated for a specific repository
 * Finds the appropriate installation based on repo owner
 */
export async function getOctokitForRepo(repoFullName: string): Promise<Octokit | null> {
  const credentials = await getAppCredentials();
  if (!credentials) {
    logger.debug('GitHub App not configured');
    return null;
  }

  const installation = await getInstallationForRepo(repoFullName);
  if (!installation) {
    logger.debug('No GitHub installation found for repo', { repoFullName });
    return null;
  }

  const token = await getInstallationToken(credentials, installation.installationId);
  return new Octokit({ auth: token });
}

/**
 * Get an Octokit instance for a specific installation
 */
export async function getOctokitForInstallation(installationId: number): Promise<Octokit | null> {
  const credentials = await getAppCredentials();
  if (!credentials) {
    logger.debug('GitHub App not configured');
    return null;
  }

  const token = await getInstallationToken(credentials, installationId);
  return new Octokit({ auth: token });
}

/**
 * Legacy: Get Octokit for a project (uses repo lookup internally)
 * @deprecated Use getOctokitForRepo instead
 */
export async function getOctokit(repoFullName: string): Promise<Octokit | null> {
  return getOctokitForRepo(repoFullName);
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
 * Get the URL for installing the GitHub App on an account/org
 * No longer requires projectId - installations are account-level
 */
export async function getInstallUrl(): Promise<string | null> {
  const credentials = await getAppCredentials();
  if (!credentials) {
    return null;
  }

  // Direct user to install the app
  return `https://github.com/apps/${credentials.appSlug}/installations/new`;
}

/**
 * Get status of GitHub App configuration
 */
export async function getAppStatus(): Promise<{
  configured: boolean;
  appName?: string;
  appSlug?: string;
  htmlUrl?: string;
  installations?: Array<{
    accountLogin: string;
    accountType: string;
    installedAt: string;
  }>;
}> {
  const credentials = await getAppCredentials();
  if (!credentials) {
    return { configured: false };
  }

  const installations = await getAllInstallations();

  return {
    configured: true,
    appName: credentials.appName,
    appSlug: credentials.appSlug,
    htmlUrl: credentials.htmlUrl,
    installations: installations.map(i => ({
      accountLogin: i.accountLogin,
      accountType: i.accountType,
      installedAt: i.installedAt,
    })),
  };
}

/**
 * Repository info returned from listing
 */
export interface GitHubRepository {
  id: number;
  name: string;
  fullName: string;
  private: boolean;
  defaultBranch: string;
  description: string | null;
  htmlUrl: string;
  cloneUrl: string;
  owner: {
    login: string;
    type: string;
  };
}

/**
 * List all repositories accessible via our GitHub App installations
 */
export async function listRepositories(): Promise<GitHubRepository[]> {
  const installations = await getAllInstallations();
  if (installations.length === 0) {
    return [];
  }

  const allRepos: GitHubRepository[] = [];

  for (const installation of installations) {
    try {
      const octokit = await getOctokitForInstallation(installation.installationId);
      if (!octokit) continue;

      // List repos for this installation
      const { data } = await octokit.rest.apps.listReposAccessibleToInstallation({
        per_page: 100,
      });

      for (const repo of data.repositories) {
        allRepos.push({
          id: repo.id,
          name: repo.name,
          fullName: repo.full_name,
          private: repo.private,
          defaultBranch: repo.default_branch,
          description: repo.description,
          htmlUrl: repo.html_url,
          cloneUrl: repo.clone_url,
          owner: {
            login: repo.owner.login,
            type: repo.owner.type,
          },
        });
      }
    } catch (error: unknown) {
      const httpError = error as { status?: number };
      // If installation not found (404), it's stale - remove it
      if (httpError.status === 404) {
        logger.warn('Stale installation found, removing', {
          installationId: installation.installationId,
          account: installation.accountLogin,
        });
        await deleteInstallationByAccount(installation.accountLogin);
      } else {
        logger.error('Failed to list repos for installation', {
          installationId: installation.installationId,
          error,
        });
      }
    }
  }

  // Sort by full name
  allRepos.sort((a, b) => a.fullName.localeCompare(b.fullName));

  return allRepos;
}

/**
 * Get status of GitHub installations (account-level, not project-level)
 */
export async function getInstallationsStatus(): Promise<{
  hasInstallations: boolean;
  installations: Array<{
    accountLogin: string;
    accountType: string;
    installedAt: string;
  }>;
}> {
  const installations = await getAllInstallations();

  return {
    hasInstallations: installations.length > 0,
    installations: installations.map(i => ({
      accountLogin: i.accountLogin,
      accountType: i.accountType,
      installedAt: i.installedAt,
    })),
  };
}

/**
 * @deprecated Use getInstallationsStatus instead
 */
export async function getInstallationStatus(accountLogin: string): Promise<{
  installed: boolean;
  accountLogin?: string;
  accountType?: string;
  installedAt?: string;
}> {
  const installation = await getInstallationByAccount(accountLogin);
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
