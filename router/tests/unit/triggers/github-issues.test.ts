import { GitHubIssuesTrigger } from '@ai-bug-fixer/service-github';
import { mockWebhookPayloads } from '../../fixtures/webhook-payloads';
import { createMockWebhookRequest } from '../../mocks/webhook-request';
import crypto from 'crypto';

// Mock the VCS module for secret retrieval
const mockGetGitHubWebhookSecret = jest.fn();
jest.mock('../../../src/vcs', () => ({
  getGitHubToken: jest.fn().mockResolvedValue('test-token'),
  getGitHubWebhookSecret: (...args: unknown[]) => mockGetGitHubWebhookSecret(...args),
}));

// Mock the GitHub App service
jest.mock('../../../src/github/app-service', () => ({
  getAppCredentials: jest.fn().mockResolvedValue({
    appSlug: 'test-ai-bug-fixer',
    appName: 'Test AI Bug Fixer',
  }),
}));

// Mock the projects config
jest.mock('../../../src/config/projects', () => ({
  findProjectByRepo: jest.fn((repoFullName: string) => {
    if (repoFullName === 'owner/repo') {
      return {
        id: 'test-project',
        repo: 'git@github.com:owner/repo.git',
        repoFullName: 'owner/repo',
        branch: 'main',
        vcs: { type: 'github' as const, owner: 'owner', repo: 'repo' },
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
    }
    return undefined;
  }),
}));

// Mock global fetch
global.fetch = jest.fn();

describe('GitHubIssuesTrigger', () => {
  let trigger: GitHubIssuesTrigger;

  beforeEach(() => {
    trigger = new GitHubIssuesTrigger();
    jest.clearAllMocks();
    mockGetGitHubWebhookSecret.mockReset();
    delete process.env.GITHUB_WEBHOOK_SECRET;
    delete process.env.GITHUB_TOKEN;
  });

  afterEach(() => {
    delete process.env.GITHUB_WEBHOOK_SECRET;
    delete process.env.GITHUB_TOKEN;
    jest.clearAllMocks();
  });

  describe('validateWebhook', () => {
    it('should validate correct GitHub signature', async () => {
      mockGetGitHubWebhookSecret.mockResolvedValue('test-secret');

      const body = { test: 'payload' };
      const signature = 'sha256=' + crypto
        .createHmac('sha256', 'test-secret')
        .update(JSON.stringify(body))
        .digest('hex');

      const mockReq = createMockWebhookRequest({ 'x-hub-signature-256': signature }, body);

      const result = await trigger.validateWebhook(mockReq);
      expect(result).toBe(true);
    });

    it('should reject incorrect signature', async () => {
      mockGetGitHubWebhookSecret.mockResolvedValue('test-secret');

      const mockReq = createMockWebhookRequest(
        { 'x-hub-signature-256': 'sha256=invalid' },
        { test: 'payload' }
      );

      const result = await trigger.validateWebhook(mockReq);
      expect(result).toBe(false);
    });

    it('should reject webhook without signature', async () => {
      mockGetGitHubWebhookSecret.mockResolvedValue('test-secret');

      const mockReq = createMockWebhookRequest({}, { test: 'payload' });

      const result = await trigger.validateWebhook(mockReq);
      expect(result).toBe(false);
    });

    it('should reject webhook when secret not configured', async () => {
      mockGetGitHubWebhookSecret.mockResolvedValue(null);

      const body = { test: 'payload' };
      const signature = 'sha256=' + crypto
        .createHmac('sha256', 'test-secret')
        .update(JSON.stringify(body))
        .digest('hex');

      const mockReq = createMockWebhookRequest({ 'x-hub-signature-256': signature }, body);

      const result = await trigger.validateWebhook(mockReq);
      expect(result).toBe(false);
    });

    it('should extract projectId from payload and use project-specific secret', async () => {
      mockGetGitHubWebhookSecret.mockResolvedValue('project-secret');

      const body = {
        action: 'opened',
        repository: { full_name: 'owner/repo' },
        issue: { number: 1 },
      };
      const signature = 'sha256=' + crypto
        .createHmac('sha256', 'project-secret')
        .update(JSON.stringify(body))
        .digest('hex');

      const mockReq = createMockWebhookRequest({ 'x-hub-signature-256': signature }, body);

      const result = await trigger.validateWebhook(mockReq);

      expect(result).toBe(true);
      // Verify getGitHubWebhookSecret was called with the project ID
      expect(mockGetGitHubWebhookSecret).toHaveBeenCalledWith('test-project');
    });

    it('should fall back to global secret when repository not in payload', async () => {
      mockGetGitHubWebhookSecret.mockResolvedValue('global-secret');

      const body = { test: 'payload-without-repo' };
      const signature = 'sha256=' + crypto
        .createHmac('sha256', 'global-secret')
        .update(JSON.stringify(body))
        .digest('hex');

      const mockReq = createMockWebhookRequest({ 'x-hub-signature-256': signature }, body);

      const result = await trigger.validateWebhook(mockReq);

      expect(result).toBe(true);
      // Should be called with undefined (no projectId)
      expect(mockGetGitHubWebhookSecret).toHaveBeenCalledWith(undefined);
    });

    it('should fall back to global secret when repository not configured', async () => {
      mockGetGitHubWebhookSecret.mockResolvedValue('global-secret');

      const body = {
        action: 'opened',
        repository: { full_name: 'unknown/repo' }, // Not in mock config
        issue: { number: 1 },
      };
      const signature = 'sha256=' + crypto
        .createHmac('sha256', 'global-secret')
        .update(JSON.stringify(body))
        .digest('hex');

      const mockReq = createMockWebhookRequest({ 'x-hub-signature-256': signature }, body);

      const result = await trigger.validateWebhook(mockReq);

      expect(result).toBe(true);
      // Should be called with undefined since project wasn't found
      expect(mockGetGitHubWebhookSecret).toHaveBeenCalledWith(undefined);
    });

    it('should use rawBody for signature verification when available', async () => {
      mockGetGitHubWebhookSecret.mockResolvedValue('test-secret');

      // Raw body with different formatting than JSON.stringify would produce
      const rawBody = '{"action":"opened","repository":{"full_name":"owner/repo"}}';
      const body = JSON.parse(rawBody);

      // Signature computed on rawBody, not JSON.stringify(body)
      const signature = 'sha256=' + crypto
        .createHmac('sha256', 'test-secret')
        .update(rawBody)
        .digest('hex');

      const mockReq = createMockWebhookRequest(
        { 'x-hub-signature-256': signature },
        body,
        rawBody
      );

      const result = await trigger.validateWebhook(mockReq);
      expect(result).toBe(true);
    });

    it('should fail validation when rawBody differs from re-serialized body', async () => {
      mockGetGitHubWebhookSecret.mockResolvedValue('test-secret');

      // Simulate GitHub sending JSON with different key order/whitespace
      const rawBody = '{ "repository": { "full_name": "owner/repo" }, "action": "opened" }';
      const body = JSON.parse(rawBody);

      // Signature computed on rawBody
      const signature = 'sha256=' + crypto
        .createHmac('sha256', 'test-secret')
        .update(rawBody)
        .digest('hex');

      // Without rawBody, it would try JSON.stringify(body) which produces different output
      const mockReqWithoutRaw = createMockWebhookRequest(
        { 'x-hub-signature-256': signature },
        body
        // No rawBody - will fall back to JSON.stringify
      );

      // This should fail because JSON.stringify produces different output
      const resultWithoutRaw = await trigger.validateWebhook(mockReqWithoutRaw);
      expect(resultWithoutRaw).toBe(false);

      // With rawBody, it should succeed
      const mockReqWithRaw = createMockWebhookRequest(
        { 'x-hub-signature-256': signature },
        body,
        rawBody
      );

      const resultWithRaw = await trigger.validateWebhook(mockReqWithRaw);
      expect(resultWithRaw).toBe(true);
    });
  });

  describe('parseWebhook - issue events', () => {
    it('should parse issue opened with trigger label', async () => {
      const payload = mockWebhookPayloads.github.issueOpenedWithTriggerLabel;

      const event = await trigger.parseWebhook(payload);

      expect(event).toBeTruthy();
      expect(event?.triggerType).toBe('github-issues');
      expect(event?.triggerId).toBe('owner/repo#43');
      expect(event?.projectId).toBe('test-project');
      expect(event?.title).toBe('GitHub Issue #43: Memory leak in background worker');
      expect(event?.metadata.issueNumber).toBe(43);
      expect(event?.metadata.labels).toContain('ai-fix');
      expect(event?.metadata.labels).toContain('bug');
    });

    it('should parse issue labeled event', async () => {
      const payload = mockWebhookPayloads.github.issueLabeled;

      const event = await trigger.parseWebhook(payload);

      expect(event).toBeTruthy();
      expect(event?.triggerType).toBe('github-issues');
      expect(event?.triggerId).toBe('owner/repo#45');
      expect(event?.title).toBe('GitHub Issue #45: Crash on startup');
      expect(event?.metadata.labels).toContain('ai-fix');
    });

    it('should ignore issue opened without trigger label when requireLabel is false', async () => {
      const payload = mockWebhookPayloads.github.issueOpenedWithoutLabel;

      const event = await trigger.parseWebhook(payload);

      // requireLabel: false means we don't require label on open,
      // but we won't process it unless labeled later
      expect(event).toBeNull();
    });

    it('should ignore issue edited event', async () => {
      const payload = mockWebhookPayloads.github.issueEdited;

      const event = await trigger.parseWebhook(payload);

      expect(event).toBeNull();
    });

    it('should return null for unknown repository', async () => {
      const payload = {
        action: 'opened',
        issue: {
          number: 1,
          title: 'Test',
          body: 'Test',
          state: 'open',
          html_url: 'https://github.com/unknown/repo/issues/1',
          url: 'https://api.github.com/repos/unknown/repo/issues/1',
          created_at: '2024-01-10T12:00:00Z',
          user: { login: 'user' },
          labels: [{ name: 'ai-fix' }],
        },
        repository: {
          full_name: 'unknown/repo',
          name: 'repo',
          owner: { login: 'unknown' },
        },
      };

      const event = await trigger.parseWebhook(payload);

      expect(event).toBeNull();
    });
  });

  describe('parseWebhook - comment events', () => {
    it('should parse comment with trigger phrase from allowed user', async () => {
      const payload = mockWebhookPayloads.github.issueCommentWithTrigger;

      const event = await trigger.parseWebhook(payload);

      expect(event).toBeTruthy();
      expect(event?.triggerType).toBe('github-issues');
      expect(event?.triggerId).toContain('owner/repo#46-comment-');
      expect(event?.title).toBe('GitHub Issue #46: Database connection timeout');
      expect(event?.metadata.triggeredBy).toBe('maintainer-alice');
      expect(event?.metadata.triggerComment).toContain('/claude fix');
      expect(event?.metadata.triggerCommentUrl).toBeTruthy();
    });

    it('should ignore comment without trigger phrase', async () => {
      const payload = mockWebhookPayloads.github.issueCommentWithoutTrigger;

      const event = await trigger.parseWebhook(payload);

      expect(event).toBeNull();
    });

    it('should ignore comment with trigger phrase from unauthorized user', async () => {
      const payload = mockWebhookPayloads.github.issueCommentUnauthorizedUser;

      const event = await trigger.parseWebhook(payload);

      expect(event).toBeNull();
    });
  });

  describe('requireLabel enforcement', () => {
    it('should enforce requireLabel when true', async () => {
      // Temporarily modify mock to require label
      const { findProjectByRepo } = require('../../../src/config/projects');
      findProjectByRepo.mockReturnValueOnce({
        id: 'test-project',
        repo: 'git@github.com:owner/repo.git',
        repoFullName: 'owner/repo',
        branch: 'main',
        vcs: { type: 'github' as const, owner: 'owner', repo: 'repo' },
        triggers: {
          github: {
            issues: true,
            labels: ['ai-fix'],
            requireLabel: true,  // Require label
          },
        },
      });

      const payload = mockWebhookPayloads.github.issueOpened;  // Has 'bug' but not 'ai-fix'

      const event = await trigger.parseWebhook(payload);

      expect(event).toBeNull();
    });

    it('should allow issue with required label', async () => {
      const { findProjectByRepo } = require('../../../src/config/projects');
      findProjectByRepo.mockReturnValueOnce({
        id: 'test-project',
        repo: 'git@github.com:owner/repo.git',
        repoFullName: 'owner/repo',
        branch: 'main',
        vcs: { type: 'github' as const, owner: 'owner', repo: 'repo' },
        triggers: {
          github: {
            issues: true,
            labels: ['ai-fix'],
            requireLabel: true,
          },
        },
      });

      const payload = mockWebhookPayloads.github.issueOpenedWithTriggerLabel;  // Has 'ai-fix'

      const event = await trigger.parseWebhook(payload);

      expect(event).toBeTruthy();
    });
  });

  describe('shouldProcess', () => {
    it('should process open issues', async () => {
      const event = {
        triggerType: 'github-issues',
        triggerId: 'owner/repo#1',
        projectId: 'test-project',
        title: 'Test Issue',
        description: 'Test',
        metadata: { state: 'open', issueNumber: 1 },
        raw: {},
      };

      const result = await trigger.shouldProcess(event);

      expect(result).toBe(true);
    });

    it('should not process closed issues', async () => {
      const event = {
        triggerType: 'github-issues',
        triggerId: 'owner/repo#1',
        projectId: 'test-project',
        title: 'Test Issue',
        description: 'Test',
        metadata: { state: 'closed', issueNumber: 1 },
        raw: {},
      };

      const result = await trigger.shouldProcess(event);

      expect(result).toBe(false);
    });
  });

  describe('determineSeverity', () => {
    it('should return critical for critical labels', async () => {
      const payload = {
        action: 'opened',
        issue: {
          ...mockWebhookPayloads.github.issueOpenedWithTriggerLabel.issue,
          labels: [{ name: 'critical' }, { name: 'urgent' }, { name: 'ai-fix' }],  // Include trigger label
        },
        repository: mockWebhookPayloads.github.issueOpenedWithTriggerLabel.repository,
      };

      const event = await trigger.parseWebhook(payload);

      expect(event?.metadata.severity).toBe('critical');
    });

    it('should return high for bug labels', async () => {
      const payload = mockWebhookPayloads.github.issueOpenedWithTriggerLabel;

      const event = await trigger.parseWebhook(payload);

      expect(event?.metadata.severity).toBe('high');  // Has 'bug' label
    });

    it('should return low for unlabeled issues', async () => {
      const payload = {
        action: 'labeled',
        issue: {
          ...mockWebhookPayloads.github.issueLabeled.issue,
          labels: [{ name: 'question' }],
        },
        label: { name: 'question' },
        repository: mockWebhookPayloads.github.issueLabeled.repository,
      };

      const event = await trigger.parseWebhook(payload);

      expect(event?.metadata.severity).toBe('low');
    });
  });

  describe('getTools', () => {
    it('should return empty array (GitHub tools provided via MCP)', async () => {
      const event = {
        triggerType: 'github-issues',
        triggerId: 'owner/repo#42',
        projectId: 'test-project',
        title: 'Test Issue',
        description: 'Test',
        metadata: {
          issueNumber: 42,
          issueUrl: 'https://github.com/owner/repo/issues/42',
        },
        raw: {},
      };

      const tools = await trigger.getTools(event);

      // GitHub tools are now provided via MCP server (github_* tools)
      // No bash scripts needed - Claude uses MCP tools directly
      expect(tools).toHaveLength(0);
    });
  });

  describe('updateStatus', () => {
    beforeEach(() => {
      process.env.GITHUB_TOKEN = 'test-token';
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({}),
      });
    });

    it('should post success comment with PR link', async () => {
      const event = {
        triggerType: 'github-issues',
        triggerId: 'owner/repo#42',
        projectId: 'test-project',
        title: 'Test Issue',
        description: 'Test',
        metadata: { issueNumber: 42 },
        raw: {},
      };

      await trigger.updateStatus(event, {
        fixed: true,
        prUrl: 'https://github.com/owner/repo/pull/123',
        analysis: {
          canAutoFix: true,
          confidence: 'high',
          summary: 'Fixed null pointer exception',
          rootCause: 'Missing null check',
          filesInvolved: ['src/service.ts'],
          complexity: 'simple',
        },
      });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/owner/repo/issues/42/comments',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-token',
          }),
          body: expect.stringContaining('✅ Fix completed successfully'),
        })
      );

      const call = (global.fetch as jest.Mock).mock.calls[0];
      const body = JSON.parse(call[1].body).body;
      expect(body).toContain('Pull request: https://github.com/owner/repo/pull/123');
      expect(body).toContain('Fixed null pointer exception');
      expect(body).toContain('Missing null check');
      expect(body).toContain('src/service.ts');
    });

    it('should post failure comment with reason', async () => {
      const event = {
        triggerType: 'github-issues',
        triggerId: 'owner/repo#42',
        projectId: 'test-project',
        title: 'Test Issue',
        description: 'Test',
        metadata: { issueNumber: 42 },
        raw: {},
      };

      await trigger.updateStatus(event, {
        fixed: false,
        reason: 'Could not reproduce issue',
        analysis: {
          canAutoFix: false,
          confidence: 'low',
          summary: 'Unable to identify root cause',
          rootCause: 'Insufficient information in issue',
          reason: 'Issue description lacks reproduction steps',
          filesInvolved: [],
          complexity: 'complex',
        },
      });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/owner/repo/issues/42/comments',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('❌ Unable to automatically fix'),
        })
      );

      const call = (global.fetch as jest.Mock).mock.calls[0];
      const body = JSON.parse(call[1].body).body;
      expect(body).toContain('Could not reproduce issue');
      expect(body).toContain('Unable to identify root cause');
    });
  });

  describe('addComment', () => {
    beforeEach(() => {
      process.env.GITHUB_TOKEN = 'test-token';
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({}),
      });
    });

    it('should post comment to issue', async () => {
      const event = {
        triggerType: 'github-issues',
        triggerId: 'owner/repo#42',
        projectId: 'test-project',
        title: 'Test Issue',
        description: 'Test',
        metadata: { issueNumber: 42 },
        raw: {},
      };

      await trigger.addComment(event, 'This is a test comment');

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/owner/repo/issues/42/comments',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('This is a test comment'),
        })
      );
    });
  });
});
