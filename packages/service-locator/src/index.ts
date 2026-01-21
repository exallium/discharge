/**
 * Service Locator
 *
 * Provides a singleton service registry for plugin management.
 */

export { ServiceRegistry } from './registry';

import { ServiceRegistry } from './registry';

/**
 * Singleton service registry instance
 * Use this for all service lookups
 */
export const registry = new ServiceRegistry();
