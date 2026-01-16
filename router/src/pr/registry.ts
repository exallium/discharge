/**
 * PR Provider Registry
 *
 * Manages available PR providers and finds the appropriate one for a project.
 */

import type { ProjectConfig } from '../config/projects';
import type { PRProvider } from './provider';
import { logger } from '../logger';

/**
 * Registry of PR providers
 */
const providers: PRProvider[] = [];

/**
 * Register a PR provider
 * Called by VCS plugins during initialization
 *
 * @param provider - PR provider to register
 */
export function registerPRProvider(provider: PRProvider): void {
  // Avoid duplicate registrations
  const existing = providers.find((p) => p.id === provider.id);
  if (existing) {
    logger.debug('PR provider already registered', { id: provider.id });
    return;
  }

  providers.push(provider);
  logger.info('PR provider registered', { id: provider.id });
}

/**
 * Unregister a PR provider
 *
 * @param providerId - ID of provider to unregister
 */
export function unregisterPRProvider(providerId: string): void {
  const index = providers.findIndex((p) => p.id === providerId);
  if (index >= 0) {
    providers.splice(index, 1);
    logger.info('PR provider unregistered', { id: providerId });
  }
}

/**
 * Find a PR provider that can handle the given project
 *
 * @param project - Project configuration
 * @returns Provider that can create PRs, or null if none available
 */
export async function findPRProvider(project: ProjectConfig): Promise<PRProvider | null> {
  // Try providers in order of registration (typically VCS type matches project)
  for (const provider of providers) {
    try {
      const canCreate = await provider.canCreatePR(project);
      if (canCreate) {
        logger.debug('Found PR provider for project', {
          projectId: project.id,
          providerId: provider.id,
        });
        return provider;
      }
    } catch (error) {
      logger.warn('Error checking PR provider capability', {
        projectId: project.id,
        providerId: provider.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logger.debug('No PR provider available for project', { projectId: project.id });
  return null;
}

/**
 * Get all registered PR providers
 */
export function listPRProviders(): PRProvider[] {
  return [...providers];
}

/**
 * Check if any PR providers are registered
 */
export function hasPRProviders(): boolean {
  return providers.length > 0;
}

/**
 * Clear all registered providers (for testing)
 */
export function clearPRProviders(): void {
  providers.length = 0;
}
