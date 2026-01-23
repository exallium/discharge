/**
 * Sentry Service Plugin
 *
 * Provides Sentry trigger for AI Bug Fixer to receive and process Sentry issue webhooks.
 */

import type {
  ServiceManifest,
  SecretRequirement,
} from '@discharge/service-sdk';
import { SentryTrigger } from './trigger';

// Export the trigger class for direct use
export { SentryTrigger } from './trigger';

// Export webhook types for consumers
export * from './types/webhooks';

/**
 * Create a Sentry service manifest
 *
 * The trigger is instantiated directly since it uses SDK providers
 * (no external dependencies need to be injected)
 */
export function createSentryService(): ServiceManifest {
  const trigger = new SentryTrigger();

  return {
    id: 'sentry',
    name: 'Sentry',
    version: '1.0.0',

    trigger,

    getRequiredSecrets(): SecretRequirement[] {
      return trigger.getRequiredSecrets();
    },

    async initialize(): Promise<void> {
      console.log('[SentryService] Initialized');
    },

    async validate() {
      const errors: string[] = [];
      const warnings: string[] = [];

      // Trigger is always available since it uses SDK providers
      // Validation of secrets happens at runtime when processing webhooks

      return {
        valid: errors.length === 0,
        errors,
        warnings,
      };
    },
  };
}

// Default export is the factory function
export default createSentryService;
