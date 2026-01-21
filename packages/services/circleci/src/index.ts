/**
 * CircleCI Service Plugin
 *
 * Provides CircleCI trigger for AI Bug Fixer to receive and process CircleCI webhook events
 * for failed workflows and jobs.
 */

import type {
  ServiceManifest,
  SecretRequirement,
} from '@ai-bug-fixer/service-sdk';
import { CircleCITrigger } from './trigger';

// Export the trigger class for direct use
export { CircleCITrigger } from './trigger';

// Export webhook types for consumers
export * from './types/webhooks';

/**
 * Create a CircleCI service manifest
 *
 * The trigger is instantiated directly since it uses SDK providers
 * (no external dependencies need to be injected)
 */
export function createCircleCIService(): ServiceManifest {
  const trigger = new CircleCITrigger();

  return {
    id: 'circleci',
    name: 'CircleCI',
    version: '1.0.0',

    trigger,

    getRequiredSecrets(): SecretRequirement[] {
      return trigger.getRequiredSecrets();
    },

    async initialize(): Promise<void> {
      console.log('[CircleCIService] Initialized');
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
export default createCircleCIService;
