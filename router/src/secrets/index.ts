/**
 * Secret Management
 *
 * Provides secret retrieval with project isolation support.
 * Secrets are stored encrypted in the database with fallback to environment variables.
 *
 * Priority order:
 * 1. Project-specific secret: projects:{projectId}:{plugin}:{key}
 * 2. Global secret: {plugin}:{key}
 * 3. Environment variable: {PLUGIN}_{KEY} (uppercase, underscores)
 *
 * Plugins define their own secrets - this module just provides the retrieval mechanism.
 */

import { settingsRepo } from '../db/repositories';
import { logger } from '../logger';

/**
 * Get a secret value with project isolation support
 *
 * @param plugin - Plugin identifier (e.g., 'github', 'sentry')
 * @param key - Secret key within the plugin (e.g., 'token', 'webhook_secret')
 * @param projectId - Optional project ID for project-specific secrets
 * @param envOverride - Optional custom environment variable name
 * @returns The secret value or null if not found
 *
 * @example
 * // Get project-specific GitHub token
 * const token = await getSecret('github', 'token', 'my-project');
 *
 * // Get global GitHub token
 * const token = await getSecret('github', 'token');
 *
 * // With custom env var name
 * const token = await getSecret('github', 'token', undefined, 'GITHUB_TOKEN');
 */
export async function getSecret(
  plugin: string,
  key: string,
  projectId?: string,
  envOverride?: string
): Promise<string | null> {
  try {
    // 1. Check project-specific secret first
    if (projectId) {
      const projectKey = `projects:${projectId}:${plugin}:${key}`;
      const projectSecret = await settingsRepo.getDecrypted(projectKey);
      if (projectSecret) {
        logger.debug('Secret retrieved (project-specific)', { plugin, key, projectId });
        return projectSecret;
      }
    }

    // 2. Check global secret
    const globalKey = `${plugin}:${key}`;
    const globalSecret = await settingsRepo.getDecrypted(globalKey);
    if (globalSecret) {
      logger.debug('Secret retrieved (global)', { plugin, key });
      return globalSecret;
    }

    // 3. Fall back to environment variable
    const envKey = envOverride || `${plugin.toUpperCase()}_${key.toUpperCase()}`;
    const envValue = process.env[envKey];
    if (envValue) {
      logger.debug('Secret retrieved (environment)', { plugin, key, envKey });
      return envValue;
    }

    return null;
  } catch (error) {
    logger.error('Failed to retrieve secret', {
      plugin,
      key,
      projectId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Set a secret value
 *
 * @param plugin - Plugin identifier
 * @param key - Secret key
 * @param value - Secret value (will be encrypted)
 * @param projectId - Optional project ID for project-specific secrets
 */
export async function setSecret(
  plugin: string,
  key: string,
  value: string,
  projectId?: string
): Promise<void> {
  const settingKey = projectId
    ? `projects:${projectId}:${plugin}:${key}`
    : `${plugin}:${key}`;

  await settingsRepo.set(settingKey, value, {
    encrypted: true,
    category: projectId ? 'project-secrets' : 'secrets',
    description: `${plugin} ${key}${projectId ? ` for project ${projectId}` : ''}`,
    projectId, // Set for cascade delete on project deletion
  });

  logger.info('Secret stored', {
    plugin,
    key,
    projectId: projectId || 'global',
  });
}

/**
 * Delete a secret
 */
export async function deleteSecret(
  plugin: string,
  key: string,
  projectId?: string
): Promise<void> {
  const settingKey = projectId
    ? `projects:${projectId}:${plugin}:${key}`
    : `${plugin}:${key}`;

  await settingsRepo.remove(settingKey);

  logger.info('Secret deleted', {
    plugin,
    key,
    projectId: projectId || 'global',
  });
}

/**
 * Check if a secret is configured (at any level)
 */
export async function hasSecret(
  plugin: string,
  key: string,
  projectId?: string
): Promise<boolean> {
  const value = await getSecret(plugin, key, projectId);
  return value !== null;
}

/**
 * List all secrets for a project (keys only, not values)
 */
export async function listProjectSecrets(projectId: string): Promise<string[]> {
  const prefix = `projects:${projectId}:`;
  const settings = await settingsRepo.getByCategory('project-secrets');

  return settings
    .filter((s: { key: string }) => s.key.startsWith(prefix))
    .map((s: { key: string }) => s.key.replace(prefix, ''));
}
