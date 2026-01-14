import { SentryTrigger } from '../../../src/triggers/sentry';
import { mockWebhookPayloads } from '../../fixtures/webhook-payloads';
import { TriggerEvent } from '../../../src/triggers/base';
import { createMockWebhookRequest } from '../../mocks/webhook-request';
import * as projectsModule from '../../../src/config/projects';

// Mock the projects module
jest.mock('../../../src/config/projects', () => ({
  findProjectsBySource: jest.fn(),
}));

describe('SentryTrigger', () => {
  let trigger: SentryTrigger;
  const mockFindProjectsBySource = projectsModule.findProjectsBySource as jest.MockedFunction<
    typeof projectsModule.findProjectsBySource
  >;

  // Mock project configuration
  const mockProject = {
    id: 'test-project',
    repo: 'git@github.com:owner/my-app.git',
    repoFullName: 'owner/my-app',
    branch: 'main',
    vcs: {
      type: 'github' as const,
      owner: 'owner',
      repo: 'my-app',
    },
    triggers: {
      sentry: {
        projectSlug: 'my-app',
        enabled: true,
      },
    },
  };

  beforeEach(() => {
    trigger = new SentryTrigger();
    jest.clearAllMocks();

    // Default: return mock project
    mockFindProjectsBySource.mockResolvedValue([mockProject]);

    // Clear environment variables
    delete process.env.SENTRY_WEBHOOK_SECRET;
    delete process.env.SENTRY_AUTH_TOKEN;
  });

  describe('id and type', () => {
    it('should have correct id and type', () => {
      expect(trigger.id).toBe('sentry');
      expect(trigger.type).toBe('sentry');
    });
  });

  describe('validateWebhook', () => {
    it('should accept webhook without signature when no secret is configured', async () => {
      const req = createMockWebhookRequest({}, mockWebhookPayloads.sentry.issueCreated);

      const result = await trigger.validateWebhook(req);
      expect(result).toBe(true);
    });

    it('should reject webhook with signature when no secret is configured', async () => {
      const req = createMockWebhookRequest(
        { 'sentry-hook-signature': 'some-signature' },
        mockWebhookPayloads.sentry.issueCreated
      );

      const result = await trigger.validateWebhook(req);
      expect(result).toBe(false);
    });

    it('should validate correct signature when secret is configured', async () => {
      const secret = 'test-secret';
      process.env.SENTRY_WEBHOOK_SECRET = secret;

      const body = mockWebhookPayloads.sentry.issueCreated;
      const crypto = require('crypto');
      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(JSON.stringify(body))
        .digest('hex');

      const req = createMockWebhookRequest(
        { 'sentry-hook-signature': expectedSignature },
        body
      );

      const result = await trigger.validateWebhook(req);
      expect(result).toBe(true);
    });

    it('should reject incorrect signature', async () => {
      process.env.SENTRY_WEBHOOK_SECRET = 'test-secret';

      const req = createMockWebhookRequest(
        { 'sentry-hook-signature': 'invalid-signature' },
        mockWebhookPayloads.sentry.issueCreated
      );

      const result = await trigger.validateWebhook(req);
      expect(result).toBe(false);
    });
  });

  describe('parseWebhook', () => {
    it('should parse issue created webhook', async () => {
      const payload = mockWebhookPayloads.sentry.issueCreated;
      const event = await trigger.parseWebhook(payload);

      expect(event).toBeTruthy();
      expect(event?.triggerType).toBe('sentry');
      expect(event?.triggerId).toBe('12345');
      expect(event?.projectId).toBe('test-project');
      expect(event?.title).toBe('TypeError: Cannot read property "name" of undefined');
      expect(event?.description).toBe('TypeError: Cannot read property "name" of undefined');
      expect(event?.metadata.severity).toBe('critical');
      expect(event?.metadata.level).toBe('error');
      expect(event?.metadata.platform).toBe('javascript');
      expect(event?.metadata.environment).toBe('production');
      expect(event?.metadata.tags).toContain('environment:production');
      expect(event?.metadata.tags).toContain('browser:Chrome');
      expect(event?.links?.web).toBe('https://sentry.io/organizations/my-org/issues/12345/');
    });

    it('should parse minimal issue payload', async () => {
      const payload = mockWebhookPayloads.sentry.issueCreatedMinimal;
      const event = await trigger.parseWebhook(payload);

      expect(event).toBeTruthy();
      expect(event?.triggerId).toBe('67890');
      expect(event?.title).toBe('Error in payment processing');
      expect(event?.description).toBe('ValueError: Invalid payment amount: -100');
      expect(event?.metadata.severity).toBe('critical'); // fatal maps to critical
      expect(event?.metadata.environment).toBe('staging');
    });

    it('should return null for non-created actions', async () => {
      const payload = mockWebhookPayloads.sentry.issueResolved;
      const event = await trigger.parseWebhook(payload);

      expect(event).toBeNull();
    });

    it('should return null when project slug is missing', async () => {
      const payload = mockWebhookPayloads.sentry.issueWithoutProjectSlug;
      const event = await trigger.parseWebhook(payload);

      expect(event).toBeNull();
    });

    it('should return null when no matching project is found', async () => {
      mockFindProjectsBySource.mockResolvedValue([]);

      const payload = mockWebhookPayloads.sentry.issueCreated;
      const event = await trigger.parseWebhook(payload);

      expect(event).toBeNull();
      expect(mockFindProjectsBySource).toHaveBeenCalledWith('sentry', expect.any(Function));
    });

    it('should use first project when multiple matches are found', async () => {
      const secondProject = { ...mockProject, id: 'second-project' };
      mockFindProjectsBySource.mockResolvedValue([mockProject, secondProject]);

      const payload = mockWebhookPayloads.sentry.issueCreated;
      const event = await trigger.parseWebhook(payload);

      expect(event?.projectId).toBe('test-project');
    });

    it('should handle issue without metadata gracefully', async () => {
      const payload = {
        action: 'created',
        data: {
          issue: {
            id: '99999',
            title: 'Simple error',
            level: 'warning',
            platform: 'node',
            permalink: 'https://sentry.io/issue/99999/',
            firstSeen: '2024-01-10T15:00:00Z',
            lastSeen: '2024-01-10T15:00:00Z',
            count: 1,
            userCount: 1,
            tags: [],
          },
          project: {
            slug: 'my-app',
            name: 'My Application',
          },
        },
      };

      const event = await trigger.parseWebhook(payload);

      expect(event).toBeTruthy();
      expect(event?.title).toBe('Simple error');
      expect(event?.description).toBe('Simple error');
      expect(event?.metadata.severity).toBe('high'); // warning maps to high
    });
  });

  describe('getTools', () => {
    const mockEvent: TriggerEvent = {
      triggerType: 'sentry',
      triggerId: '12345',
      projectId: 'test-project',
      title: 'Test error',
      description: 'Test description',
      metadata: {
        severity: 'critical',
        level: 'error',
        platform: 'javascript',
      },
      links: {
        web: 'https://sentry.io/issue/12345/',
      },
      raw: {},
    };

    it('should return basic tools when no auth token is configured', async () => {
      const tools = await trigger.getTools(mockEvent);

      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('show-issue-summary');
      expect(tools[0].script).toContain('Test error');
    });

    it('should return API tools when auth token is configured', async () => {
      process.env.SENTRY_AUTH_TOKEN = 'test-token';

      const tools = await trigger.getTools(mockEvent);

      expect(tools).toHaveLength(4);
      expect(tools.map(t => t.name)).toEqual([
        'get-sentry-issue',
        'get-sentry-events',
        'get-latest-event',
        'show-issue-summary',
      ]);

      // Check API tools have auth token
      const apiTool = tools[0];
      expect(apiTool.script).toContain('Authorization: Bearer test-token');
      expect(apiTool.script).toContain('https://sentry.io/api/0/issues/12345/');
      expect(apiTool.env?.SENTRY_AUTH_TOKEN).toBe('test-token');
    });
  });

  describe('getPromptContext', () => {
    it('should generate comprehensive prompt context', () => {
      const event: TriggerEvent = {
        triggerType: 'sentry',
        triggerId: '12345',
        projectId: 'test-project',
        title: 'TypeError: Cannot read property "name" of undefined',
        description: 'TypeError: Cannot read property "name" of undefined',
        metadata: {
          severity: 'critical',
          level: 'error',
          platform: 'javascript',
          environment: 'production',
          culprit: 'src/services/user.ts in getUser',
          count: 42,
          userCount: 15,
          tags: ['environment:production', 'browser:Chrome'],
        },
        links: {
          web: 'https://sentry.io/issue/12345/',
        },
        raw: {},
      };

      const context = trigger.getPromptContext(event);

      expect(context).toContain('TypeError: Cannot read property "name" of undefined');
      expect(context).toContain('Severity:** critical');
      expect(context).toContain('Level:** error');
      expect(context).toContain('Platform:** javascript');
      expect(context).toContain('Environment:** production');
      expect(context).toContain('Culprit:** src/services/user.ts in getUser');
      expect(context).toContain('Occurrences:** 42 (15 users affected)');
      expect(context).toContain('Tags:** environment:production, browser:Chrome');
      expect(context).toContain('[View in Sentry](https://sentry.io/issue/12345/)');
    });

    it('should handle minimal metadata', () => {
      const event: TriggerEvent = {
        triggerType: 'sentry',
        triggerId: '67890',
        projectId: 'test-project',
        title: 'Simple error',
        description: 'Simple error',
        metadata: {},
        raw: {},
      };

      const context = trigger.getPromptContext(event);

      expect(context).toContain('Simple error');
      expect(context).toContain('Severity:** unknown');
      expect(context).toContain('Level:** unknown');
    });
  });

  describe('shouldProcess', () => {
    it('should process error level issues', async () => {
      const event: TriggerEvent = {
        triggerType: 'sentry',
        triggerId: '12345',
        projectId: 'test-project',
        title: 'Error',
        description: 'Error',
        metadata: { level: 'error' },
        raw: {},
      };

      const result = await trigger.shouldProcess(event);
      expect(result).toBe(true);
    });

    it('should process fatal level issues', async () => {
      const event: TriggerEvent = {
        triggerType: 'sentry',
        triggerId: '12345',
        projectId: 'test-project',
        title: 'Fatal',
        description: 'Fatal',
        metadata: { level: 'fatal' },
        raw: {},
      };

      const result = await trigger.shouldProcess(event);
      expect(result).toBe(true);
    });

    it('should process warning level issues', async () => {
      const event: TriggerEvent = {
        triggerType: 'sentry',
        triggerId: '12345',
        projectId: 'test-project',
        title: 'Warning',
        description: 'Warning',
        metadata: { level: 'warning' },
        raw: {},
      };

      const result = await trigger.shouldProcess(event);
      expect(result).toBe(true);
    });

    it('should skip debug level issues', async () => {
      const event: TriggerEvent = {
        triggerType: 'sentry',
        triggerId: '12345',
        projectId: 'test-project',
        title: 'Debug',
        description: 'Debug',
        metadata: { level: 'debug' },
        raw: {},
      };

      const result = await trigger.shouldProcess(event);
      expect(result).toBe(false);
    });

    it('should skip info level issues', async () => {
      const event: TriggerEvent = {
        triggerType: 'sentry',
        triggerId: '12345',
        projectId: 'test-project',
        title: 'Info',
        description: 'Info',
        metadata: { level: 'info' },
        raw: {},
      };

      const result = await trigger.shouldProcess(event);
      expect(result).toBe(false);
    });
  });

  describe('getLink', () => {
    it('should generate markdown link', () => {
      const event: TriggerEvent = {
        triggerType: 'sentry',
        triggerId: '12345',
        projectId: 'test-project',
        title: 'TypeError in user service',
        description: 'Error',
        metadata: {},
        links: {
          web: 'https://sentry.io/issue/12345/',
        },
        raw: {},
      };

      const link = trigger.getLink(event);

      expect(link).toBe('[TypeError in user service](https://sentry.io/issue/12345/)');
    });

    it('should handle missing web link', () => {
      const event: TriggerEvent = {
        triggerType: 'sentry',
        triggerId: '12345',
        projectId: 'test-project',
        title: 'Test',
        description: 'Test',
        metadata: {},
        raw: {},
      };

      const link = trigger.getLink(event);

      expect(link).toBe('[Test](#)');
    });
  });

  describe('updateStatus', () => {
    beforeEach(() => {
      global.fetch = jest.fn();
    });

    it('should update issue status when fixed', async () => {
      process.env.SENTRY_AUTH_TOKEN = 'test-token';
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        statusText: 'OK',
      });

      const event: TriggerEvent = {
        triggerType: 'sentry',
        triggerId: '12345',
        projectId: 'test-project',
        title: 'Test',
        description: 'Test',
        metadata: {},
        raw: {},
      };

      await trigger.updateStatus(event, { fixed: true });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://sentry.io/api/0/issues/12345/',
        expect.objectContaining({
          method: 'PUT',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
            'Content-Type': 'application/json',
          }),
          body: expect.stringContaining('"status":"resolved"'),
        })
      );
    });

    it('should not update status when not fixed', async () => {
      process.env.SENTRY_AUTH_TOKEN = 'test-token';

      const event: TriggerEvent = {
        triggerType: 'sentry',
        triggerId: '12345',
        projectId: 'test-project',
        title: 'Test',
        description: 'Test',
        metadata: {},
        raw: {},
      };

      await trigger.updateStatus(event, { fixed: false });

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should handle missing auth token gracefully', async () => {
      const event: TriggerEvent = {
        triggerType: 'sentry',
        triggerId: '12345',
        projectId: 'test-project',
        title: 'Test',
        description: 'Test',
        metadata: {},
        raw: {},
      };

      await trigger.updateStatus(event, { fixed: true });

      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('addComment', () => {
    beforeEach(() => {
      global.fetch = jest.fn();
    });

    it('should add comment to issue', async () => {
      process.env.SENTRY_AUTH_TOKEN = 'test-token';
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        statusText: 'OK',
      });

      const event: TriggerEvent = {
        triggerType: 'sentry',
        triggerId: '12345',
        projectId: 'test-project',
        title: 'Test',
        description: 'Test',
        metadata: {},
        raw: {},
      };

      await trigger.addComment(event, 'Test comment');

      expect(global.fetch).toHaveBeenCalledWith(
        'https://sentry.io/api/0/issues/12345/notes/',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
            'Content-Type': 'application/json',
          }),
          body: expect.stringContaining('"text":"Test comment"'),
        })
      );
    });

    it('should handle missing auth token gracefully', async () => {
      const event: TriggerEvent = {
        triggerType: 'sentry',
        triggerId: '12345',
        projectId: 'test-project',
        title: 'Test',
        description: 'Test',
        metadata: {},
        raw: {},
      };

      await trigger.addComment(event, 'Test comment');

      expect(global.fetch).not.toHaveBeenCalled();
    });
  });
});
