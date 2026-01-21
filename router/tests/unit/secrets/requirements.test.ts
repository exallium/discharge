/**
 * Tests for secret requirements aggregation
 *
 * Verifies that secrets are properly aggregated from VCS and trigger plugins.
 * Note: GitHub uses GitHub App authentication, so no personal access token is required.
 */

import {
  getProjectSecretRequirements,
  getAllSecretRequirements,
  isSharedSecret,
  formatUsedBy,
  AggregatedSecretRequirement,
} from '../../../src/secrets/requirements';
import { ProjectConfig } from '../../../src/config/projects';

// Mock the service-locator registry
jest.mock('@ai-bug-fixer/service-locator', () => ({
  registry: {
    getTriggerByType: jest.fn((id: string) => {
      const triggers: Record<string, { getRequiredSecrets: () => Array<{ id: string; label: string; description: string; required: boolean }> }> = {
        // github-issues no longer requires github_token - uses GitHub App authentication
        'github-issues': {
          getRequiredSecrets: () => [],
        },
        sentry: {
          getRequiredSecrets: () => [
            {
              id: 'sentry_token',
              label: 'Sentry Auth Token',
              description: 'Token for Sentry API',
              required: true,
            },
            {
              id: 'sentry_webhook_secret',
              label: 'Sentry Client Secret',
              description: 'Client Secret from Internal Integration',
              required: true,
            },
          ],
        },
        circleci: {
          getRequiredSecrets: () => [
            {
              id: 'circleci_token',
              label: 'CircleCI Token',
              description: 'Token for CircleCI API',
              required: true,
            },
            {
              id: 'circleci_webhook_secret',
              label: 'CircleCI Webhook Secret',
              description: 'Secret for webhook validation',
              required: false,
            },
          ],
        },
      };
      return triggers[id] || null;
    }),
  },
}));

describe('Secret Requirements Aggregation', () => {
  // Helper to create a minimal project config
  function createProject(options: {
    vcsType?: string;
    sentryEnabled?: boolean;
    githubIssuesEnabled?: boolean;
    circleCIEnabled?: boolean;
  } = {}): ProjectConfig {
    return {
      id: 'test-project',
      name: 'Test Project',
      repository: 'https://github.com/test/repo',
      branch: 'main',
      vcs: {
        type: (options.vcsType || 'github') as 'github' | 'gitlab' | 'bitbucket' | 'self-hosted',
      },
      triggers: {
        sentry: options.sentryEnabled ? { enabled: true } : undefined,
        github: options.githubIssuesEnabled ? { issues: true } : undefined,
        circleci: options.circleCIEnabled ? { enabled: true } : undefined,
      },
      runner: {
        type: 'claude-code',
      },
    } as ProjectConfig;
  }

  describe('getProjectSecretRequirements', () => {
    it('should return empty for GitHub project with no triggers (GitHub App handles auth)', () => {
      const project = createProject({ vcsType: 'github' });
      const requirements = getProjectSecretRequirements(project);

      // GitHub uses GitHub App authentication - no secrets required for VCS
      expect(requirements).toHaveLength(0);
    });

    it('should return VCS secrets for GitLab project', () => {
      const project = createProject({ vcsType: 'gitlab' });
      const requirements = getProjectSecretRequirements(project);

      expect(requirements).toHaveLength(1);
      expect(requirements[0].id).toBe('gitlab_token');
      expect(requirements[0].usedBy).toEqual(['vcs']);
    });

    it('should return VCS secrets for Bitbucket project', () => {
      const project = createProject({ vcsType: 'bitbucket' });
      const requirements = getProjectSecretRequirements(project);

      expect(requirements).toHaveLength(1);
      expect(requirements[0].id).toBe('bitbucket_token');
      expect(requirements[0].usedBy).toEqual(['vcs']);
    });

    it('should return empty array for unknown VCS type with no triggers', () => {
      const project = createProject({ vcsType: 'self-hosted' });
      const requirements = getProjectSecretRequirements(project);

      expect(requirements).toHaveLength(0);
    });

    it('should include trigger secrets when triggers are enabled', () => {
      const project = createProject({ vcsType: 'github', sentryEnabled: true });
      const requirements = getProjectSecretRequirements(project);

      const ids = requirements.map((r) => r.id);
      // GitHub VCS uses App auth, so only Sentry secrets are needed
      expect(ids).toContain('sentry_token');
      expect(ids).toContain('sentry_webhook_secret');
      expect(ids).not.toContain('github_token'); // GitHub App handles this
    });

    it('should return empty for GitHub project with github-issues (both use App auth)', () => {
      const project = createProject({ vcsType: 'github', githubIssuesEnabled: true });
      const requirements = getProjectSecretRequirements(project);

      // Both GitHub VCS and github-issues use GitHub App authentication
      expect(requirements).toHaveLength(0);
    });

    it('should aggregate secrets from multiple triggers', () => {
      const project = createProject({
        vcsType: 'github',
        sentryEnabled: true,
        circleCIEnabled: true,
      });
      const requirements = getProjectSecretRequirements(project);

      const ids = requirements.map((r) => r.id);
      // GitHub VCS uses App auth, so only Sentry and CircleCI secrets needed
      expect(ids).not.toContain('github_token');
      expect(ids).toContain('sentry_token');
      expect(ids).toContain('sentry_webhook_secret');
      expect(ids).toContain('circleci_token');
      expect(ids).toContain('circleci_webhook_secret');
    });

    it('should handle all triggers enabled without GitHub token', () => {
      const project = createProject({
        vcsType: 'github',
        sentryEnabled: true,
        githubIssuesEnabled: true,
        circleCIEnabled: true,
      });
      const requirements = getProjectSecretRequirements(project);

      // GitHub uses App auth, so no github_token should be required
      const githubToken = requirements.find((r) => r.id === 'github_token');
      expect(githubToken).toBeUndefined();

      // Each unique secret should appear only once
      const uniqueIds = [...new Set(requirements.map((r) => r.id))];
      expect(uniqueIds.length).toBe(requirements.length);
    });
  });

  describe('getAllSecretRequirements', () => {
    it('should return all known secrets across all plugins', () => {
      const requirements = getAllSecretRequirements();

      const ids = requirements.map((r) => r.id);
      // GitHub uses App auth, so no github_token
      expect(ids).not.toContain('github_token');
      expect(ids).toContain('gitlab_token');
      expect(ids).toContain('bitbucket_token');
      expect(ids).toContain('sentry_token');
      expect(ids).toContain('circleci_token');
    });

    it('should not have duplicate secret IDs', () => {
      const requirements = getAllSecretRequirements();

      const ids = requirements.map((r) => r.id);
      const uniqueIds = [...new Set(ids)];
      expect(uniqueIds.length).toBe(ids.length);
    });
  });

  describe('isSharedSecret', () => {
    it('should return false for GitHub project (App auth, no secrets needed)', () => {
      const project = createProject({ vcsType: 'github', githubIssuesEnabled: true });

      // No github_token required with GitHub App
      expect(isSharedSecret('github_token', project)).toBe(false);
    });

    it('should return false for secrets used by single plugin', () => {
      const project = createProject({ vcsType: 'github', sentryEnabled: true });

      expect(isSharedSecret('sentry_token', project)).toBe(false);
    });

    it('should return false for non-existent secrets', () => {
      const project = createProject({ vcsType: 'github' });

      expect(isSharedSecret('nonexistent_secret', project)).toBe(false);
    });
  });

  describe('formatUsedBy', () => {
    it('should format VCS correctly', () => {
      expect(formatUsedBy(['vcs'])).toBe('VCS');
    });

    it('should format trigger names correctly', () => {
      expect(formatUsedBy(['github-issues'])).toBe('GitHub Issues');
      expect(formatUsedBy(['sentry'])).toBe('Sentry');
      expect(formatUsedBy(['circleci'])).toBe('CircleCI');
    });

    it('should join multiple values with comma', () => {
      expect(formatUsedBy(['vcs', 'github-issues'])).toBe('VCS, GitHub Issues');
    });

    it('should handle unknown identifiers', () => {
      expect(formatUsedBy(['unknown'])).toBe('unknown');
    });

    it('should handle empty array', () => {
      expect(formatUsedBy([])).toBe('');
    });
  });
});
