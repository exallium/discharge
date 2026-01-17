/**
 * Tests for GitHub PR Provider
 *
 * Verifies that the GitHub PR provider correctly creates PRs
 * using GitHub App authentication.
 */

import { GitHubPRProvider, getGitHubPRProvider } from '../../../src/pr/github-provider';
import type { ProjectConfig } from '../../../src/config/projects';
import { getGitHubVCS, isGitHubAvailable } from '../../../src/vcs';

// Mock dependencies
jest.mock('../../../src/vcs', () => ({
  getGitHubVCS: jest.fn(),
  isGitHubAvailable: jest.fn(),
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

  // Mock VCS instance
  const mockVCS = {
    createPullRequest: jest.fn(),
  };

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
    it('should return true for GitHub project with installation', async () => {
      (isGitHubAvailable as jest.Mock).mockResolvedValue(true);

      const project = createProject('github');
      const result = await provider.canCreatePR(project);

      expect(result).toBe(true);
      expect(isGitHubAvailable).toHaveBeenCalledWith('test-project');
    });

    it('should return false for GitHub project without installation', async () => {
      (isGitHubAvailable as jest.Mock).mockResolvedValue(false);

      const project = createProject('github');
      const result = await provider.canCreatePR(project);

      expect(result).toBe(false);
    });

    it('should return false for non-GitHub project', async () => {
      (isGitHubAvailable as jest.Mock).mockResolvedValue(true);

      const project = createProject('gitlab');
      const result = await provider.canCreatePR(project);

      expect(result).toBe(false);
      // Should not even check for installation
      expect(isGitHubAvailable).not.toHaveBeenCalled();
    });
  });

  describe('createPullRequest', () => {
    it('should create PR successfully with GitHub App', async () => {
      mockVCS.createPullRequest.mockResolvedValue({
        number: 42,
        htmlUrl: 'https://github.com/owner/repo/pull/42',
      });
      (getGitHubVCS as jest.Mock).mockResolvedValue(mockVCS);

      const options = {
        projectId: 'test-project',
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
      expect(getGitHubVCS).toHaveBeenCalledWith('test-project');
    });

    it('should return error with compare URL when no installation', async () => {
      (getGitHubVCS as jest.Mock).mockResolvedValue(null);

      const options = {
        projectId: 'test-project',
        owner: 'test-owner',
        repo: 'test-repo',
        head: 'fix/bug-123',
        base: 'main',
        title: 'Fix bug #123',
        body: 'This PR fixes the bug.',
      };

      const result = await provider.createPullRequest(options);

      expect(result.success).toBe(false);
      expect(result.error).toBe('GitHub App not installed for this project');
      expect(result.compareUrl).toBe(
        'https://github.com/test-owner/test-repo/compare/main...fix/bug-123'
      );
    });

    it('should handle VCS errors gracefully', async () => {
      mockVCS.createPullRequest.mockRejectedValue(new Error('API rate limit exceeded'));
      (getGitHubVCS as jest.Mock).mockResolvedValue(mockVCS);

      const options = {
        projectId: 'test-project',
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
