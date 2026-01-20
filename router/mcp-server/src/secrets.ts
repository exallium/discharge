/**
 * Secret retrieval for MCP server
 *
 * Read-only access to project secrets with the same priority order as the main app:
 * 1. Project-specific secret: projects:{projectId}:{plugin}:{key}
 * 2. Global secret: {plugin}:{key}
 * 3. Environment variable: {PLUGIN}_{KEY}
 */

import { getSetting } from './db.js';
import { decrypt, isDecryptionAvailable } from './encryption.js';

/**
 * Get a secret value with project isolation support
 *
 * @param plugin - Plugin identifier (e.g., 'sentry', 'github')
 * @param key - Secret key within the plugin (e.g., 'auth_token', 'webhook_secret')
 * @param projectId - Optional project ID for project-specific secrets
 * @returns The secret value or null if not found
 */
export async function getSecret(
  plugin: string,
  key: string,
  projectId?: string
): Promise<string | null> {
  try {
    // 1. Check project-specific secret first
    if (projectId) {
      const projectKey = `projects:${projectId}:${plugin}:${key}`;
      const projectSecret = await getDecryptedSetting(projectKey);
      if (projectSecret) {
        return projectSecret;
      }
    }

    // 2. Check global secret
    const globalKey = `${plugin}:${key}`;
    const globalSecret = await getDecryptedSetting(globalKey);
    if (globalSecret) {
      return globalSecret;
    }

    // 3. Fall back to environment variable
    const envKey = `${plugin.toUpperCase()}_${key.toUpperCase()}`;
    const envValue = process.env[envKey];
    if (envValue) {
      return envValue;
    }

    return null;
  } catch (error) {
    console.error(`[MCP] Failed to retrieve secret: ${plugin}:${key}`, error);
    return null;
  }
}

/**
 * Get and decrypt a setting from the database
 */
async function getDecryptedSetting(key: string): Promise<string | null> {
  const setting = await getSetting(key);
  if (!setting) {
    return null;
  }

  if (setting.encrypted) {
    if (!isDecryptionAvailable()) {
      console.error(`[MCP] Cannot decrypt setting ${key}: encryption key not available`);
      return null;
    }
    return decrypt(setting.value);
  }

  return setting.value;
}
