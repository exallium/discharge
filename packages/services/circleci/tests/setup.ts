/**
 * Test setup for CircleCI service package
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
  repoFullName: 'owner/repo',
  branch: 'main',
  triggers: {
    circleci: {
      enabled: true,
      projectSlug: 'gh/owner/repo',
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

    // Also check common CircleCI environment variables
    if (plugin === 'circleci' && key === 'webhook_secret') {
      return process.env.CIRCLECI_WEBHOOK_SECRET || null;
    }
    if (plugin === 'circleci' && key === 'token') {
      return process.env.CIRCLECI_TOKEN || null;
    }

    return null;
  },
};

export const mockProjectProvider: ProjectProvider = {
  async findByRepo(repoFullName: string) {
    if (repoFullName === 'owner/repo') {
      return mockProject;
    }
    return null;
  },
  async findBySource<T>(source: string, filter: (config: T) => boolean) {
    if (source === 'circleci') {
      // Check if the filter matches our mock project
      const circleciConfig = mockProject.triggers.circleci as unknown as T;
      if (filter(circleciConfig)) {
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
  delete process.env.CIRCLECI_WEBHOOK_SECRET;
  delete process.env.CIRCLECI_TOKEN;

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
