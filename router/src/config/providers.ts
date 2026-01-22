/**
 * SDK Provider Adapters
 *
 * This module creates adapters that implement the SDK provider interfaces.
 * These adapters wrap the router's existing implementations to make them
 * accessible to service plugins via the SDK.
 */

import type {
  SecretsProvider,
  ProjectProvider,
  VCSAuthProvider,
  LoggerProvider,
  TriggerProjectConfig,
} from '@ai-bug-fixer/service-sdk';
import { getSecret } from '../secrets';
import {
  findProjectByRepo,
  findProjectsBySource,
  type ProjectConfig,
  type TriggerSourceConfig,
} from './projects';
import {
  getAppCredentials,
  getInstallationForRepo,
  getOctokitForInstallation,
} from '../github/app-service';
import { logger as routerLogger } from '../logger';

/**
 * Convert router ProjectConfig to SDK TriggerProjectConfig
 */
function toTriggerProjectConfig(project: ProjectConfig): TriggerProjectConfig {
  return {
    id: project.id,
    repoFullName: project.repoFullName,
    branch: project.branch,
    triggers: project.triggers,
  };
}

/**
 * Secrets provider adapter
 *
 * Wraps the router's getSecret function to implement SecretsProvider interface.
 */
export const secretsAdapter: SecretsProvider = {
  async getSecret(
    plugin: string,
    key: string,
    projectId?: string,
    envFallback?: string
  ): Promise<string | null> {
    return getSecret(plugin, key, projectId, envFallback);
  },
};

/**
 * Project provider adapter
 *
 * Wraps the router's project lookup functions to implement ProjectProvider interface.
 */
export const projectsAdapter: ProjectProvider = {
  async findByRepo(repoFullName: string): Promise<TriggerProjectConfig | null> {
    const project = await findProjectByRepo(repoFullName);
    if (!project) return null;
    return toTriggerProjectConfig(project);
  },

  async findBySource<T>(
    source: string,
    filter: (config: T) => boolean
  ): Promise<TriggerProjectConfig[]> {
    // Wrap the filter to work with our TriggerSourceConfig
    const matcher = (config: TriggerSourceConfig): boolean => {
      return filter(config as unknown as T);
    };

    const projects = await findProjectsBySource(source, matcher);
    return projects.map(toTriggerProjectConfig);
  },
};

/**
 * VCS auth provider adapter
 *
 * Wraps the router's GitHub App service to implement VCSAuthProvider interface.
 * Currently supports GitHub via GitHub App authentication.
 * Future: Could be extended to support GitLab, Bitbucket, etc.
 */
export const vcsAuthAdapter: VCSAuthProvider = {
  async getToken(repoFullName: string): Promise<string | null> {
    const credentials = await getAppCredentials();
    if (!credentials) return null;

    const installation = await getInstallationForRepo(repoFullName);
    if (!installation) return null;

    // Get Octokit which will have a valid token
    const octokit = await getOctokitForInstallation(installation.installationId);
    if (!octokit) return null;

    // Extract the token from Octokit's auth
    const auth = await octokit.auth() as { token: string };
    return auth.token;
  },

  async getWebhookSecret(projectId?: string): Promise<string | null> {
    // First try project-specific secret
    if (projectId) {
      const projectSecret = await getSecret('github', 'webhook_secret', projectId);
      if (projectSecret) return projectSecret;
    }

    // Then try global secret
    const globalSecret = await getSecret('github', 'webhook_secret');
    if (globalSecret) return globalSecret;

    // Fall back to app credentials
    const credentials = await getAppCredentials();
    return credentials?.webhookSecret ?? null;
  },

  async getAppSlug(): Promise<string | null> {
    const credentials = await getAppCredentials();
    return credentials?.appSlug ?? null;
  },
};

/**
 * Logger adapter
 *
 * Wraps the router's logger to implement LoggerProvider interface.
 */
export const loggerAdapter: LoggerProvider = {
  debug(message: string, meta?: Record<string, unknown>): void {
    routerLogger.debug(message, meta);
  },
  info(message: string, meta?: Record<string, unknown>): void {
    routerLogger.info(message, meta);
  },
  warn(message: string, meta?: Record<string, unknown>): void {
    routerLogger.warn(message, meta);
  },
  error(message: string, meta?: Record<string, unknown>): void {
    routerLogger.error(message, meta);
  },
};
