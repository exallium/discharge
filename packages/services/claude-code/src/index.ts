/**
 * Claude Code Service Plugin
 *
 * Provides Claude Code runner for AI Bug Fixer to execute AI agents in Docker containers.
 * This is the default, recommended runner for the system.
 */

import type {
  ServiceManifest,
  SecretRequirement,
} from '@ai-bug-fixer/service-sdk';
import { getLogger } from '@ai-bug-fixer/service-sdk';
import { ClaudeCodeRunner } from './runner';

// Re-export runner class for advanced use cases
export { ClaudeCodeRunner } from './runner';

// Re-export supporting utilities
export * from './bug-config';
export * from './workspace';
export * from './prompts';

/**
 * Create a Claude Code service manifest
 *
 * This function creates the service manifest with the Claude Code runner.
 * The runner uses SDK providers for secrets and GitHub auth, which must be
 * configured before using the service.
 *
 * @returns Service manifest for registration
 */
export function createClaudeCodeService(): ServiceManifest {
  const runner = new ClaudeCodeRunner();
  const logger = getLogger();

  return {
    id: 'claude-code',
    name: 'Claude Code',
    version: '1.0.0',

    runner,

    getRequiredSecrets(): SecretRequirement[] {
      return runner.getRequiredSecrets();
    },

    async initialize(): Promise<void> {
      logger.info('[ClaudeCodeService] Initialized');
    },

    async validate() {
      const errors: string[] = [];
      const warnings: string[] = [];

      // Check if runner is available
      const isAvailable = await runner.isAvailable();
      if (!isAvailable) {
        errors.push('Claude Code runner is not available (Docker not running or image missing)');
      }

      // Validate runner configuration
      const validation = await runner.validate();
      if (!validation.valid) {
        errors.push(validation.error || 'Runner validation failed');
      }

      return {
        valid: errors.length === 0,
        errors,
        warnings,
      };
    },
  };
}

// Default export for convenience
export default createClaudeCodeService;
