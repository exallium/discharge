/**
 * Kanban/CLI Service Plugin
 *
 * Provides a trigger for CLI-submitted tasks.
 * No VCS or runner — uses the existing Claude Code runner.
 */

import type { ServiceManifest } from '@discharge/service-sdk';
import { KanbanTrigger } from './trigger';

export { KanbanTrigger } from './trigger';
export * from './types';

/**
 * Create a Kanban service manifest
 */
export function createKanbanService(): ServiceManifest {
  const trigger = new KanbanTrigger();

  return {
    id: 'kanban',
    name: 'Kanban (CLI)',
    version: '1.0.0',

    trigger,

    getRequiredSecrets() {
      return trigger.getRequiredSecrets();
    },

    async initialize() {
      console.log('[KanbanService] Initialized');
    },

    async validate() {
      return {
        valid: true,
        errors: [],
        warnings: [],
      };
    },
  };
}

export default createKanbanService;
