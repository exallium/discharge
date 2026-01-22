/**
 * Service Locator
 *
 * Provides a singleton service registry for plugin management.
 * Uses globalThis to ensure true singleton across module instances
 * (required for Next.js where instrumentation and API routes may
 * be bundled separately).
 */

export { ServiceRegistry } from './registry';

import { ServiceRegistry } from './registry';

// String key for global registry
const REGISTRY_KEY = '__AI_BUG_FIXER_SERVICE_REGISTRY__';

// Type declaration for globalThis
declare global {
  // eslint-disable-next-line no-var
  var __AI_BUG_FIXER_SERVICE_REGISTRY__: ServiceRegistry | undefined;
}

/**
 * Get or create the singleton registry instance
 * Uses globalThis to ensure same instance across all module loads
 */
function getOrCreateRegistry(): ServiceRegistry {
  if (!globalThis[REGISTRY_KEY]) {
    globalThis[REGISTRY_KEY] = new ServiceRegistry();
  }
  return globalThis[REGISTRY_KEY]!;
}

/**
 * Singleton service registry instance
 * Use this for all service lookups
 */
export const registry = getOrCreateRegistry();
