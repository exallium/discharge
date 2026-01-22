/**
 * Trigger Plugin Registry
 *
 * This module bridges between the legacy import-based trigger system
 * and the new service-based architecture.
 *
 * All trigger lookups now go through the service registry.
 */

import { registry } from '@ai-bug-fixer/service-locator';
import type { TriggerPlugin } from '@ai-bug-fixer/service-sdk';

// Re-export TriggerPlugin type from SDK for backward compatibility
export type { TriggerPlugin } from '@ai-bug-fixer/service-sdk';

// Re-export from base for backward compatibility
export * from './base';

/**
 * Get a trigger plugin by its ID
 * Triggers are identified by ID (e.g., 'github', 'sentry', 'circleci')
 */
export function getTriggerById(id: string): TriggerPlugin | undefined {
  return registry.getTriggerByType(id);
}

/**
 * Get a trigger plugin by its type
 * Note: In the service architecture, type and ID are typically the same
 */
export function getTriggerByType(type: string): TriggerPlugin | undefined {
  return registry.getTriggerByType(type);
}

/**
 * List all registered trigger IDs
 */
export function listTriggerIds(): string[] {
  return registry.getAllTriggers().map(t => t.id);
}

/**
 * List all registered triggers
 */
export function listTriggers(): TriggerPlugin[] {
  return registry.getAllTriggers();
}

/**
 * @deprecated Use the registry directly instead
 * Kept for backward compatibility
 */
export const triggers: TriggerPlugin[] = [];

// Note: The triggers array is empty at module load time.
// Use listTriggers() or registry.getAllTriggers() instead
// after services are initialized.
