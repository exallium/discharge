/**
 * SDK Context
 *
 * Provides access to configured providers for services.
 * The router configures these at startup via configureProviders().
 *
 * Usage in services:
 * ```typescript
 * import { getSecretsProvider, getProjectProvider } from '@ai-bug-fixer/service-sdk';
 *
 * const secrets = getSecretsProvider();
 * const token = await secrets.getSecret('sentry', 'auth_token');
 * ```
 */

import type {
  SecretsProvider,
  ProjectProvider,
  GitHubAuthProvider,
  LoggerProvider,
  ProviderConfig,
} from './interfaces/providers';

// Provider instances (configured by router at startup)
let secretsProvider: SecretsProvider | null = null;
let projectProvider: ProjectProvider | null = null;
let githubAuthProvider: GitHubAuthProvider | null = null;
let loggerProvider: LoggerProvider | null = null;

// Default logger that uses console
const defaultLogger: LoggerProvider = {
  debug: (message, meta) => console.debug(`[SDK] ${message}`, meta || ''),
  info: (message, meta) => console.log(`[SDK] ${message}`, meta || ''),
  warn: (message, meta) => console.warn(`[SDK] ${message}`, meta || ''),
  error: (message, meta) => console.error(`[SDK] ${message}`, meta || ''),
};

/**
 * Configure SDK providers
 *
 * Call this once at application startup (in the router) before using any services.
 *
 * @param config - Provider implementations
 *
 * @example
 * ```typescript
 * // In router/src/config/services.ts
 * import { configureProviders } from '@ai-bug-fixer/service-sdk';
 *
 * configureProviders({
 *   secrets: mySecretsAdapter,
 *   projects: myProjectsAdapter,
 *   github: myGitHubAdapter,
 *   logger: myLogger,
 * });
 * ```
 */
export function configureProviders(config: ProviderConfig): void {
  secretsProvider = config.secrets;
  projectProvider = config.projects;
  githubAuthProvider = config.github ?? null;
  loggerProvider = config.logger ?? defaultLogger;

  getLogger().info('SDK providers configured');
}

/**
 * Check if providers have been configured
 */
export function isConfigured(): boolean {
  return secretsProvider !== null && projectProvider !== null;
}

/**
 * Reset providers (primarily for testing)
 */
export function resetProviders(): void {
  secretsProvider = null;
  projectProvider = null;
  githubAuthProvider = null;
  loggerProvider = null;
}

/**
 * Get the secrets provider
 *
 * @throws Error if providers not configured
 */
export function getSecretsProvider(): SecretsProvider {
  if (!secretsProvider) {
    throw new Error(
      'SDK not configured: SecretsProvider not available. ' +
      'Call configureProviders() at application startup.'
    );
  }
  return secretsProvider;
}

/**
 * Get the project provider
 *
 * @throws Error if providers not configured
 */
export function getProjectProvider(): ProjectProvider {
  if (!projectProvider) {
    throw new Error(
      'SDK not configured: ProjectProvider not available. ' +
      'Call configureProviders() at application startup.'
    );
  }
  return projectProvider;
}

/**
 * Get the GitHub auth provider
 *
 * @returns GitHub auth provider or null if not configured
 */
export function getGitHubAuthProvider(): GitHubAuthProvider | null {
  return githubAuthProvider;
}

/**
 * Get the logger
 *
 * @returns Logger (defaults to console-based logger if not configured)
 */
export function getLogger(): LoggerProvider {
  return loggerProvider ?? defaultLogger;
}
