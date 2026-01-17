import { GitHubVCS } from '../../../src/vcs/github';
import { Octokit } from '@octokit/rest';

// Mock Octokit methods
const mockCreate = jest.fn();
const mockRequestReviewers = jest.fn();
const mockCreateComment = jest.fn();
const mockAddLabels = jest.fn();
const mockGetAuthenticated = jest.fn();

// Create a mock Octokit instance
function createMockOctokit(): Octokit {
  return {
    pulls: {
      create: mockCreate,
      requestReviewers: mockRequestReviewers,
    },
    issues: {
      createComment: mockCreateComment,
      addLabels: mockAddLabels,
    },
    users: {
      getAuthenticated: mockGetAuthenticated,
    },
  } as unknown as Octokit;
}

describe('GitHubVCS', () => {
  let github: GitHubVCS;

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();

    // Create GitHub VCS instance with mock Octokit
    github = new GitHubVCS(createMockOctokit());
  });

  describe('constructor', () => {
    it('should set id and type', () => {
      expect(github.id).toBe('github');
      expect(github.type).toBe('github');
    });
  });

  describe('createPullRequest', () => {
    it('should create a pull request successfully', async () => {
      const mockResponse = {
        data: {
          number: 42,
          url: 'https://api.github.com/repos/owner/repo/pulls/42',
          html_url: 'https://github.com/owner/repo/pull/42',
          title: 'Fix bug in user service',
          body: 'This PR fixes the bug',
          head: {
            ref: 'fix/bug-123',
          },
          base: {
            ref: 'main',
          },
        },
      };

      mockCreate.mockResolvedValue(mockResponse as any);

      const result = await github.createPullRequest(
        'owner',
        'repo',
        'fix/bug-123',
        'main',
        'Fix bug in user service',
        'This PR fixes the bug'
      );

      expect(mockCreate).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        head: 'fix/bug-123',
        base: 'main',
        title: 'Fix bug in user service',
        body: 'This PR fixes the bug',
      });

      expect(result).toEqual({
        number: 42,
        url: 'https://api.github.com/repos/owner/repo/pulls/42',
        htmlUrl: 'https://github.com/owner/repo/pull/42',
        title: 'Fix bug in user service',
        body: 'This PR fixes the bug',
        head: 'fix/bug-123',
        base: 'main',
      });
    });

    it('should handle PR creation with empty body', async () => {
      const mockResponse = {
        data: {
          number: 43,
          url: 'https://api.github.com/repos/owner/repo/pulls/43',
          html_url: 'https://github.com/owner/repo/pull/43',
          title: 'Test PR',
          body: null,
          head: { ref: 'test' },
          base: { ref: 'main' },
        },
      };

      mockCreate.mockResolvedValue(mockResponse as any);

      const result = await github.createPullRequest(
        'owner',
        'repo',
        'test',
        'main',
        'Test PR',
        ''
      );

      expect(result.body).toBe('');
    });

    it('should throw error on PR creation failure', async () => {
      const error = new Error('API rate limit exceeded');
      mockCreate.mockRejectedValue(error);

      await expect(
        github.createPullRequest(
          'owner',
          'repo',
          'fix/bug',
          'main',
          'Fix',
          'Body'
        )
      ).rejects.toThrow('API rate limit exceeded');
    });
  });

  describe('getCompareUrl', () => {
    it('should generate correct compare URL', () => {
      const url = github.getCompareUrl('owner', 'repo', 'main', 'fix/bug-123');
      expect(url).toBe('https://github.com/owner/repo/compare/main...fix/bug-123');
    });

    it('should handle branch names with special characters', () => {
      const url = github.getCompareUrl(
        'my-org',
        'my-repo',
        'develop',
        'feature/add-auth-#123'
      );
      expect(url).toBe(
        'https://github.com/my-org/my-repo/compare/develop...feature/add-auth-#123'
      );
    });
  });

  describe('formatRepoIdentifier', () => {
    it('should format repository identifier correctly', () => {
      const identifier = github.formatRepoIdentifier('owner', 'repo');
      expect(identifier).toBe('owner/repo');
    });

    it('should handle organization repos', () => {
      const identifier = github.formatRepoIdentifier('my-org', 'my-repo');
      expect(identifier).toBe('my-org/my-repo');
    });
  });

  describe('validate', () => {
    it('should validate successfully with valid token', async () => {
      mockGetAuthenticated.mockResolvedValue({
        data: { login: 'testuser', id: 12345 },
      } as any);

      const result = await github.validate();

      expect(result).toEqual({ valid: true });
      expect(mockGetAuthenticated).toHaveBeenCalled();
    });

    it('should return error on authentication failure', async () => {
      const error = new Error('Bad credentials');
      mockGetAuthenticated.mockRejectedValue(error);

      const result = await github.validate();

      expect(result).toEqual({
        valid: false,
        error: 'Bad credentials',
      });
    });

    it('should handle error without message', async () => {
      mockGetAuthenticated.mockRejectedValue(new Error());

      const result = await github.validate();

      expect(result).toEqual({
        valid: false,
        error: 'GitHub authentication failed',
      });
    });
  });

  describe('addPRComment', () => {
    it('should add comment to PR successfully', async () => {
      mockCreateComment.mockResolvedValue({ data: {} } as any);

      await github.addPRComment('owner', 'repo', 42, 'Test comment');

      expect(mockCreateComment).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        issue_number: 42,
        body: 'Test comment',
      });
    });

    it('should handle comment creation failure', async () => {
      const error = new Error('Comment creation failed');
      mockCreateComment.mockRejectedValue(error);

      await expect(
        github.addPRComment('owner', 'repo', 42, 'Comment')
      ).rejects.toThrow('Comment creation failed');
    });
  });

  describe('requestReviewers', () => {
    it('should request reviewers successfully', async () => {
      mockRequestReviewers.mockResolvedValue({ data: {} } as any);

      await github.requestReviewers('owner', 'repo', 42, ['alice', 'bob']);

      expect(mockRequestReviewers).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        pull_number: 42,
        reviewers: ['alice', 'bob'],
      });
    });

    it('should not request reviewers if array is empty', async () => {
      await github.requestReviewers('owner', 'repo', 42, []);

      expect(mockRequestReviewers).not.toHaveBeenCalled();
    });

    it('should handle single reviewer', async () => {
      mockRequestReviewers.mockResolvedValue({ data: {} } as any);

      await github.requestReviewers('owner', 'repo', 42, ['alice']);

      expect(mockRequestReviewers).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        pull_number: 42,
        reviewers: ['alice'],
      });
    });
  });

  describe('addLabels', () => {
    it('should add labels to PR successfully', async () => {
      mockAddLabels.mockResolvedValue({ data: [] } as any);

      await github.addLabels('owner', 'repo', 42, ['bug', 'automated']);

      expect(mockAddLabels).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        issue_number: 42,
        labels: ['bug', 'automated'],
      });
    });

    it('should not add labels if array is empty', async () => {
      await github.addLabels('owner', 'repo', 42, []);

      expect(mockAddLabels).not.toHaveBeenCalled();
    });

    it('should handle single label', async () => {
      mockAddLabels.mockResolvedValue({ data: [] } as any);

      await github.addLabels('owner', 'repo', 42, ['automated-fix']);

      expect(mockAddLabels).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        issue_number: 42,
        labels: ['automated-fix'],
      });
    });

    it('should handle label addition failure', async () => {
      const error = new Error('Label does not exist');
      mockAddLabels.mockRejectedValue(error);

      await expect(
        github.addLabels('owner', 'repo', 42, ['nonexistent'])
      ).rejects.toThrow('Label does not exist');
    });
  });
});
