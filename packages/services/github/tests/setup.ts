/**
 * Test setup for GitHub service package
 * Configures mock SDK providers before each test
 */

import {
  configureProviders,
  resetProviders,
  type SecretsProvider,
  type ProjectProvider,
  type VCSAuthProvider,
  type LoggerProvider,
} from '@ai-bug-fixer/service-sdk';

// Default mock project for testing
export const mockProject = {
  id: 'test-project',
  repoFullName: 'owner/repo',
  branch: 'main',
  triggers: {
    github: {
      issues: true,
      labels: ['ai-fix', 'bug'],
      requireLabel: false,
      commentTrigger: '/claude fix',
      allowedUsers: ['maintainer-alice', 'maintainer-bob'],
    },
  },
};

// Mock webhook secret (can be overridden per test)
export let mockWebhookSecret: string | null = 'test-secret';
export let mockGitHubToken: string | null = 'test-token';
export let mockAppSlug: string | null = 'test-ai-bug-fixer';

// Mock providers
export const mockSecretsProvider: SecretsProvider = {
  async getSecret(plugin: string, key: string, _projectId?: string, envFallback?: string) {
    if (plugin === 'github' && key === 'webhook_secret') {
      return mockWebhookSecret;
    }
    if (envFallback) {
      return process.env[envFallback] || null;
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
    if (source === 'github' && filter(mockProject.triggers.github as unknown as T)) {
      return [mockProject];
    }
    return [];
  },
};

export const mockVCSAuthProvider: VCSAuthProvider = {
  async getToken(_repoFullName: string) {
    return mockGitHubToken;
  },
  async getWebhookSecret(_projectId?: string) {
    return mockWebhookSecret;
  },
  async getAppSlug() {
    return mockAppSlug;
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
  // Reset mock values to defaults
  mockWebhookSecret = 'test-secret';
  mockGitHubToken = 'test-token';
  mockAppSlug = 'test-ai-bug-fixer';

  // Clear all mock logger calls
  (mockLoggerProvider.debug as jest.Mock).mockClear();
  (mockLoggerProvider.info as jest.Mock).mockClear();
  (mockLoggerProvider.warn as jest.Mock).mockClear();
  (mockLoggerProvider.error as jest.Mock).mockClear();

  // Reset and reconfigure providers
  resetProviders();
  configureProviders({
    secrets: mockSecretsProvider,
    projects: mockProjectProvider,
    vcsAuth: mockVCSAuthProvider,
    logger: mockLoggerProvider,
  });
});

// Reset providers after all tests
afterAll(() => {
  resetProviders();
});
