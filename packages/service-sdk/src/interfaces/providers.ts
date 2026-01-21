/**
 * Provider Interfaces
 *
 * These interfaces define how services access resources (secrets, projects, tokens).
 * The router provides concrete implementations at startup via configureProviders().
 *
 * Services should ONLY import from this SDK - never from the router directly.
 */

import type { TriggerProjectConfig } from './trigger';

/**
 * Provides access to secrets storage
 */
export interface SecretsProvider {
  /**
   * Get a secret value
   *
   * @param plugin - Plugin namespace (e.g., 'sentry', 'github', 'claude')
   * @param key - Key within the namespace (e.g., 'auth_token', 'webhook_secret')
   * @param projectId - Optional project ID for project-specific secrets
   * @param envFallback - Optional environment variable name to check as fallback
   * @returns The secret value or null if not found
   */
  getSecret(
    plugin: string,
    key: string,
    projectId?: string,
    envFallback?: string
  ): Promise<string | null>;
}

/**
 * Provides access to project configuration
 */
export interface ProjectProvider {
  /**
   * Find a project by repository full name
   *
   * @param repoFullName - Repository identifier (e.g., 'owner/repo')
   * @returns Project config or null if not found
   */
  findByRepo(repoFullName: string): Promise<TriggerProjectConfig | null>;

  /**
   * Find projects by trigger source with a filter
   *
   * @param source - Trigger source type (e.g., 'sentry', 'circleci')
   * @param filter - Filter function to match trigger config
   * @returns Array of matching project configs
   */
  findBySource<T>(
    source: string,
    filter: (config: T) => boolean
  ): Promise<TriggerProjectConfig[]>;
}

/**
 * Provides GitHub-specific authentication
 * Separated from SecretsProvider because GitHub App auth requires special handling
 */
export interface GitHubAuthProvider {
  /**
   * Get an installation access token for a repository
   *
   * @param repoFullName - Repository identifier (e.g., 'owner/repo')
   * @returns Installation token or null if not available
   */
  getToken(repoFullName: string): Promise<string | null>;

  /**
   * Get the webhook secret for signature verification
   *
   * @param projectId - Optional project ID for project-specific secrets
   * @returns Webhook secret or null if not configured
   */
  getWebhookSecret(projectId?: string): Promise<string | null>;

  /**
   * Get GitHub App credentials
   * Returns null if GitHub App is not configured
   */
  getAppCredentials(): Promise<{
    appId: number;
    appSlug: string;
    privateKey: string;
  } | null>;
}

/**
 * Provides logging functionality
 * Services use this instead of console.log for consistent logging
 */
export interface LoggerProvider {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/**
 * Combined provider configuration
 * Router passes this to configureProviders() at startup
 */
export interface ProviderConfig {
  secrets: SecretsProvider;
  projects: ProjectProvider;
  github?: GitHubAuthProvider;
  logger?: LoggerProvider;
}
