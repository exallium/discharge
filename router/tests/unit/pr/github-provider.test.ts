/**
 * Tests for GitHub PR Provider
 *
 * Verifies that the GitHub PR provider correctly creates PRs.
 */

import { GitHubPRProvider, getGitHubPRProvider } from '../../../src/pr/github-provider';
import type { ProjectConfig } from '../../../src/config/projects';
import { getGitHubToken } from '../../../src/vcs';
import { GitHubVCS } from '../../../src/vcs/github';

// Mock dependencies
jest.mock('../../../src/vcs', () => ({
  getGitHubToken: jest.fn(),
}));

jest.mock('../../../src/vcs/github', () => ({
  GitHubVCS: jest.fn().mockImplementation(() => ({
    createPullRequest: jest.fn().mockResolvedValue({
      number: 42,
      htmlUrl: 'https://github.com/owner/repo/pull/42',
    }),
  })),
}));

jest.mock('../../../src/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('GitHubPRProvider', () => {
  let provider: GitHubPRProvider;

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
    provider = new GitHubPRProvider();
    jest.clearAllMocks();
  });

  describe('canCreatePR', () => {
    it('should return true for GitHub project with token', async () => {
      (getGitHubToken as jest.Mock).mockResolvedValue('ghp_token123');

      const project = createProject('github');
      const result = await provider.canCreatePR(project);

      expect(result).toBe(true);
      expect(getGitHubToken).toHaveBeenCalledWith('test-project');
    });

    it('should return false for GitHub project without token', async () => {
      (getGitHubToken as jest.Mock).mockResolvedValue(null);

      const project = createProject('github');
      const result = await provider.canCreatePR(project);

      expect(result).toBe(false);
    });

    it('should return false for non-GitHub project', async () => {
      (getGitHubToken as jest.Mock).mockResolvedValue('ghp_token123');

      const project = createProject('gitlab');
      const result = await provider.canCreatePR(project);

      expect(result).toBe(false);
      // Should not even check for token
      expect(getGitHubToken).not.toHaveBeenCalled();
    });
  });

  describe('createPullRequest', () => {
    it('should create PR successfully with token', async () => {
      (getGitHubToken as jest.Mock).mockResolvedValue('ghp_token123');

      const options = {
        owner: 'test-owner',
        repo: 'test-repo',
        head: 'fix/bug-123',
        base: 'main',
        title: 'Fix bug #123',
        body: 'This PR fixes the bug.',
      };

      const result = await provider.createPullRequest(options);

      expect(result.success).toBe(true);
      expect(result.prNumber).toBe(42);
      expect(result.prUrl).toBe('https://github.com/owner/repo/pull/42');
      expect(GitHubVCS).toHaveBeenCalledWith('ghp_token123');
    });

    it('should return error with compare URL when no token', async () => {
      (getGitHubToken as jest.Mock).mockResolvedValue(null);

      const options = {
        owner: 'test-owner',
        repo: 'test-repo',
        head: 'fix/bug-123',
        base: 'main',
        title: 'Fix bug #123',
        body: 'This PR fixes the bug.',
      };

      const result = await provider.createPullRequest(options);

      expect(result.success).toBe(false);
      expect(result.error).toBe('GitHub token not configured');
      expect(result.compareUrl).toBe(
        'https://github.com/test-owner/test-repo/compare/main...fix/bug-123'
      );
    });

    it('should handle VCS errors gracefully', async () => {
      (getGitHubToken as jest.Mock).mockResolvedValue('ghp_token123');
      (GitHubVCS as jest.Mock).mockImplementation(() => ({
        createPullRequest: jest.fn().mockRejectedValue(new Error('API rate limit exceeded')),
      }));

      const options = {
        owner: 'test-owner',
        repo: 'test-repo',
        head: 'fix/bug-123',
        base: 'main',
        title: 'Fix bug #123',
        body: 'This PR fixes the bug.',
      };

      const result = await provider.createPullRequest(options);

      expect(result.success).toBe(false);
      expect(result.error).toBe('API rate limit exceeded');
      expect(result.compareUrl).toBe(
        'https://github.com/test-owner/test-repo/compare/main...fix/bug-123'
      );
    });
  });

  describe('getCompareUrl', () => {
    it('should return correct GitHub compare URL', () => {
      const url = provider.getCompareUrl({
        owner: 'test-owner',
        repo: 'test-repo',
        head: 'feature/new-thing',
        base: 'main',
      });

      expect(url).toBe(
        'https://github.com/test-owner/test-repo/compare/main...feature/new-thing'
      );
    });
  });

  describe('getGitHubPRProvider', () => {
    it('should return singleton instance', () => {
      const instance1 = getGitHubPRProvider();
      const instance2 = getGitHubPRProvider();

      expect(instance1).toBe(instance2);
    });

    it('should have correct provider ID', () => {
      const instance = getGitHubPRProvider();

      expect(instance.id).toBe('github');
    });
  });
});
