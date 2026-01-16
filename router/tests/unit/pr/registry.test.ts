/**
 * Tests for PR Provider Registry
 *
 * Verifies that PR providers can be registered and found correctly.
 */

import {
  registerPRProvider,
  unregisterPRProvider,
  findPRProvider,
  listPRProviders,
  hasPRProviders,
  clearPRProviders,
} from '../../../src/pr/registry';
import type { PRProvider } from '../../../src/pr/provider';
import type { ProjectConfig } from '../../../src/config/projects';

// Mock the logger
jest.mock('../../../src/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('PR Provider Registry', () => {
  // Helper to create a mock provider
  function createMockProvider(
    id: string,
    canCreate: boolean | ((project: ProjectConfig) => Promise<boolean>) = true
  ): PRProvider {
    return {
      id,
      canCreatePR: jest.fn().mockImplementation(
        typeof canCreate === 'function'
          ? canCreate
          : () => Promise.resolve(canCreate)
      ),
      createPullRequest: jest.fn().mockResolvedValue({
        success: true,
        prNumber: 123,
        prUrl: 'https://github.com/test/repo/pull/123',
      }),
      getCompareUrl: jest.fn().mockReturnValue('https://github.com/test/repo/compare/main...fix'),
    };
  }

  // Helper to create a minimal project config
  function createProject(vcsType = 'github'): ProjectConfig {
    return {
      id: 'test-project',
      name: 'Test Project',
      repository: 'https://github.com/test/repo',
      branch: 'main',
      vcs: {
        type: vcsType as 'github' | 'gitlab' | 'bitbucket' | 'self-hosted',
      },
      triggers: {},
      runner: {
        type: 'claude-code',
      },
    } as ProjectConfig;
  }

  beforeEach(() => {
    clearPRProviders();
    jest.clearAllMocks();
  });

  describe('registerPRProvider', () => {
    it('should register a provider', () => {
      const provider = createMockProvider('github');

      registerPRProvider(provider);

      expect(listPRProviders()).toContain(provider);
      expect(hasPRProviders()).toBe(true);
    });

    it('should not register duplicate providers with same ID', () => {
      const provider1 = createMockProvider('github');
      const provider2 = createMockProvider('github');

      registerPRProvider(provider1);
      registerPRProvider(provider2);

      expect(listPRProviders()).toHaveLength(1);
      expect(listPRProviders()[0]).toBe(provider1);
    });

    it('should allow multiple providers with different IDs', () => {
      const github = createMockProvider('github');
      const gitlab = createMockProvider('gitlab');

      registerPRProvider(github);
      registerPRProvider(gitlab);

      expect(listPRProviders()).toHaveLength(2);
    });
  });

  describe('unregisterPRProvider', () => {
    it('should remove a registered provider', () => {
      const provider = createMockProvider('github');
      registerPRProvider(provider);

      unregisterPRProvider('github');

      expect(listPRProviders()).toHaveLength(0);
      expect(hasPRProviders()).toBe(false);
    });

    it('should handle unregistering non-existent provider', () => {
      unregisterPRProvider('nonexistent');

      // Should not throw
      expect(listPRProviders()).toHaveLength(0);
    });
  });

  describe('findPRProvider', () => {
    it('should find a provider that can create PRs', async () => {
      const provider = createMockProvider('github', true);
      registerPRProvider(provider);

      const project = createProject();
      const found = await findPRProvider(project);

      expect(found).toBe(provider);
      expect(provider.canCreatePR).toHaveBeenCalledWith(project);
    });

    it('should return null when no providers can create PRs', async () => {
      const provider = createMockProvider('github', false);
      registerPRProvider(provider);

      const project = createProject();
      const found = await findPRProvider(project);

      expect(found).toBeNull();
    });

    it('should return null when no providers are registered', async () => {
      const project = createProject();
      const found = await findPRProvider(project);

      expect(found).toBeNull();
    });

    it('should return first provider that can create PRs', async () => {
      const provider1 = createMockProvider('github', false);
      const provider2 = createMockProvider('gitlab', true);
      const provider3 = createMockProvider('bitbucket', true);

      registerPRProvider(provider1);
      registerPRProvider(provider2);
      registerPRProvider(provider3);

      const project = createProject();
      const found = await findPRProvider(project);

      expect(found).toBe(provider2);
      // Should stop checking after finding one
      expect(provider3.canCreatePR).not.toHaveBeenCalled();
    });

    it('should handle errors in canCreatePR gracefully', async () => {
      const errorProvider = createMockProvider('error', async () => {
        throw new Error('Connection failed');
      });
      const validProvider = createMockProvider('valid', true);

      registerPRProvider(errorProvider);
      registerPRProvider(validProvider);

      const project = createProject();
      const found = await findPRProvider(project);

      expect(found).toBe(validProvider);
    });

    it('should return null if all providers throw errors', async () => {
      const errorProvider = createMockProvider('error', async () => {
        throw new Error('Connection failed');
      });

      registerPRProvider(errorProvider);

      const project = createProject();
      const found = await findPRProvider(project);

      expect(found).toBeNull();
    });
  });

  describe('listPRProviders', () => {
    it('should return a copy of the providers array', () => {
      const provider = createMockProvider('github');
      registerPRProvider(provider);

      const list = listPRProviders();
      list.push(createMockProvider('fake'));

      expect(listPRProviders()).toHaveLength(1);
    });
  });

  describe('hasPRProviders', () => {
    it('should return false when no providers registered', () => {
      expect(hasPRProviders()).toBe(false);
    });

    it('should return true when providers are registered', () => {
      registerPRProvider(createMockProvider('github'));
      expect(hasPRProviders()).toBe(true);
    });
  });

  describe('clearPRProviders', () => {
    it('should remove all registered providers', () => {
      registerPRProvider(createMockProvider('github'));
      registerPRProvider(createMockProvider('gitlab'));

      clearPRProviders();

      expect(listPRProviders()).toHaveLength(0);
      expect(hasPRProviders()).toBe(false);
    });
  });
});
