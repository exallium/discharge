/**
 * Tests for secret requirements aggregation
 *
 * Verifies that secrets are properly aggregated from VCS and trigger plugins.
 */

import {
  getProjectSecretRequirements,
  getAllSecretRequirements,
  isSharedSecret,
  formatUsedBy,
  AggregatedSecretRequirement,
} from '../../../src/secrets/requirements';
import { ProjectConfig } from '../../../src/config/projects';

// Mock the triggers module
jest.mock('../../../src/triggers', () => ({
  getTriggerById: jest.fn((id: string) => {
    const triggers: Record<string, { getRequiredSecrets: () => Array<{ id: string; label: string; description: string; required: boolean }> }> = {
      'github-issues': {
        getRequiredSecrets: () => [
          {
            id: 'github_token',
            label: 'GitHub Token',
            description: 'Token for GitHub API',
            required: true,
          },
          {
            id: 'github_webhook_secret',
            label: 'GitHub Webhook Secret',
            description: 'Secret for webhook validation',
            required: false,
          },
        ],
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
            label: 'Sentry Webhook Secret',
            description: 'Secret for webhook validation',
            required: false,
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
    it('should return VCS secrets for GitHub project with no triggers', () => {
      const project = createProject({ vcsType: 'github' });
      const requirements = getProjectSecretRequirements(project);

      expect(requirements).toHaveLength(1);
      expect(requirements[0].id).toBe('github_token');
      expect(requirements[0].usedBy).toEqual(['vcs']);
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
      expect(ids).toContain('github_token');
      expect(ids).toContain('sentry_token');
      expect(ids).toContain('sentry_webhook_secret');
    });

    it('should deduplicate shared secrets between VCS and triggers', () => {
      const project = createProject({ vcsType: 'github', githubIssuesEnabled: true });
      const requirements = getProjectSecretRequirements(project);

      // github_token should appear once with usedBy containing both
      const githubToken = requirements.find((r) => r.id === 'github_token');
      expect(githubToken).toBeDefined();
      expect(githubToken!.usedBy).toContain('vcs');
      expect(githubToken!.usedBy).toContain('github-issues');
      expect(githubToken!.usedBy.length).toBe(2);

      // Should not have duplicate entries
      const tokenCount = requirements.filter((r) => r.id === 'github_token').length;
      expect(tokenCount).toBe(1);
    });

    it('should aggregate secrets from multiple triggers', () => {
      const project = createProject({
        vcsType: 'github',
        sentryEnabled: true,
        circleCIEnabled: true,
      });
      const requirements = getProjectSecretRequirements(project);

      const ids = requirements.map((r) => r.id);
      expect(ids).toContain('github_token');
      expect(ids).toContain('sentry_token');
      expect(ids).toContain('sentry_webhook_secret');
      expect(ids).toContain('circleci_token');
      expect(ids).toContain('circleci_webhook_secret');
    });

    it('should handle all triggers enabled with shared GitHub token', () => {
      const project = createProject({
        vcsType: 'github',
        sentryEnabled: true,
        githubIssuesEnabled: true,
        circleCIEnabled: true,
      });
      const requirements = getProjectSecretRequirements(project);

      // github_token should be shared between VCS and github-issues
      const githubToken = requirements.find((r) => r.id === 'github_token');
      expect(githubToken!.usedBy).toEqual(['vcs', 'github-issues']);

      // Each unique secret should appear only once
      const uniqueIds = [...new Set(requirements.map((r) => r.id))];
      expect(uniqueIds.length).toBe(requirements.length);
    });
  });

  describe('getAllSecretRequirements', () => {
    it('should return all known secrets across all plugins', () => {
      const requirements = getAllSecretRequirements();

      const ids = requirements.map((r) => r.id);
      expect(ids).toContain('github_token');
      expect(ids).toContain('gitlab_token');
      expect(ids).toContain('bitbucket_token');
      expect(ids).toContain('sentry_token');
      expect(ids).toContain('circleci_token');
    });

    it('should show github_token as shared between VCS and github-issues', () => {
      const requirements = getAllSecretRequirements();

      const githubToken = requirements.find((r) => r.id === 'github_token');
      expect(githubToken).toBeDefined();
      expect(githubToken!.usedBy).toContain('vcs:github');
      expect(githubToken!.usedBy).toContain('github-issues');
    });

    it('should not have duplicate secret IDs', () => {
      const requirements = getAllSecretRequirements();

      const ids = requirements.map((r) => r.id);
      const uniqueIds = [...new Set(ids)];
      expect(uniqueIds.length).toBe(ids.length);
    });
  });

  describe('isSharedSecret', () => {
    it('should return true for secrets used by multiple plugins', () => {
      const project = createProject({ vcsType: 'github', githubIssuesEnabled: true });

      expect(isSharedSecret('github_token', project)).toBe(true);
    });

    it('should return false for secrets used by single plugin', () => {
      const project = createProject({ vcsType: 'github', sentryEnabled: true });

      expect(isSharedSecret('sentry_token', project)).toBe(false);
      expect(isSharedSecret('github_token', project)).toBe(false);
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
