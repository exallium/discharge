/**
 * Test setup for Sentry service package
 * Configures mock SDK providers before each test
 */

import {
  configureProviders,
  resetProviders,
  type SecretsProvider,
  type ProjectProvider,
  type LoggerProvider,
} from '@discharge/service-sdk';

// Default mock project for testing
export const mockProject = {
  id: 'test-project',
  repoFullName: 'owner/my-app',
  branch: 'main',
  triggers: {
    sentry: {
      projectSlug: 'my-app',
      enabled: true,
    },
  },
};

// Mock providers
export const mockSecretsProvider: SecretsProvider = {
  async getSecret(plugin: string, key: string, _projectId?: string, envFallback?: string) {
    // Check environment variable fallback first
    if (envFallback && process.env[envFallback]) {
      return process.env[envFallback] ?? null;
    }

    // Also check common Sentry environment variables
    if (plugin === 'sentry' && key === 'webhook_secret') {
      return process.env.SENTRY_WEBHOOK_SECRET || null;
    }
    if (plugin === 'sentry' && key === 'auth_token') {
      return process.env.SENTRY_AUTH_TOKEN || null;
    }

    return null;
  },
};

export const mockProjectProvider: ProjectProvider = {
  async findByRepo(repoFullName: string) {
    if (repoFullName === 'owner/my-app') {
      return mockProject;
    }
    return null;
  },
  async findBySource<T>(source: string, filter: (config: T) => boolean) {
    if (source === 'sentry') {
      // Check if the filter matches our mock project
      const sentryConfig = mockProject.triggers.sentry as unknown as T;
      if (filter(sentryConfig)) {
        return [mockProject];
      }
    }
    return [];
  },
};

export const mockLoggerProvider: LoggerProvider = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

// Reset and configure providers before each test
beforeEach(() => {
  // Clear all mock logger calls
  (mockLoggerProvider.debug as jest.Mock).mockClear();
  (mockLoggerProvider.info as jest.Mock).mockClear();
  (mockLoggerProvider.warn as jest.Mock).mockClear();
  (mockLoggerProvider.error as jest.Mock).mockClear();

  // Clear environment variables
  delete process.env.SENTRY_WEBHOOK_SECRET;
  delete process.env.SENTRY_AUTH_TOKEN;

  // Reset and reconfigure providers
  resetProviders();
  configureProviders({
    secrets: mockSecretsProvider,
    projects: mockProjectProvider,
    logger: mockLoggerProvider,
  });
});

// Reset providers after all tests
afterAll(() => {
  resetProviders();
});
