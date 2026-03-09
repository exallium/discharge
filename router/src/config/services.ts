/**
 * Service Configuration
 *
 * Registers all service plugins with the service registry.
 * This is the central place where services are wired together.
 *
 * Architecture:
 * 1. Configure SDK providers (secrets, projects, github auth, logger)
 * 2. Create service instances (they use SDK providers internally)
 * 3. Register services with the service registry
 */

import { registry } from '@discharge/service-locator';
import { configureProviders } from '@discharge/service-sdk';
import { createGitHubService } from '@discharge/service-github';
import { createSentryService } from '@discharge/service-sentry';
import { createCircleCIService } from '@discharge/service-circleci';
import { createClaudeCodeService } from '@discharge/service-claude-code';
import { createKanbanService } from '@discharge/service-kanban';
import { logger } from '../logger';

// Import provider adapters
import {
  secretsAdapter,
  projectsAdapter,
  vcsAuthAdapter,
  loggerAdapter,
} from './providers';

/**
 * Initialize all services and register them with the registry
 *
 * This should be called once on application startup.
 * It configures SDK providers first, then creates and registers services.
 */
export async function initializeServices(): Promise<void> {
  logger.info('Initializing services...');

  // Step 1: Configure SDK providers
  // This MUST happen before creating any services
  logger.debug('Configuring SDK providers...');
  configureProviders({
    secrets: secretsAdapter,
    projects: projectsAdapter,
    vcsAuth: vcsAuthAdapter,
    logger: loggerAdapter,
  });
  logger.debug('SDK providers configured');

  // Step 2: Create and register services
  // Services now use SDK providers internally (no dependencies passed in)

  // GitHub service (trigger + VCS)
  const githubService = createGitHubService();
  registry.register(githubService);

  // Sentry service (trigger only)
  const sentryService = createSentryService();
  registry.register(sentryService);

  // CircleCI service (trigger only)
  const circleCIService = createCircleCIService();
  registry.register(circleCIService);

  // Claude Code service (runner only)
  const claudeCodeService = createClaudeCodeService();
  registry.register(claudeCodeService);

  // Kanban/CLI service (trigger only)
  const kanbanService = createKanbanService();
  registry.register(kanbanService);

  // Step 3: Initialize all registered services
  await registry.initialize();

  // Log status
  const status = registry.getStatus();
  logger.info('Services initialized', {
    serviceCount: status.serviceCount,
    triggerCount: status.triggerCount,
    runnerCount: status.runnerCount,
    vcsCount: status.vcsCount,
    services: status.services.map(s => s.id),
  });
}

/**
 * Get service registry for use throughout the application
 */
export { registry };

/**
 * Re-export types for convenience
 */
export type {
  ServiceManifest,
  TriggerPlugin,
  VCSPlugin,
  VCSPluginFactory,
  RunnerPlugin,
} from '@discharge/service-sdk';
