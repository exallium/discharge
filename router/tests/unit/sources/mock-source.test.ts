import { createMockTrigger, MockTrigger } from '../../mocks/mock-trigger';
import { mockWebhookPayloads } from '../../fixtures/webhook-payloads';
import { TriggerEvent } from '../../../src/triggers/base';

describe('MockTrigger', () => {
  let trigger: MockTrigger;

  beforeEach(() => {
    trigger = createMockTrigger();
  });

  describe('validateWebhook', () => {
    it('should validate webhook by default', async () => {
      const result = await trigger.validateWebhook({} as any);
      expect(result).toBe(true);
      expect(trigger.calls.validateWebhook).toBe(1);
    });

    it('should allow configuration of validation result', async () => {
      trigger.setValidation(false);
      const result = await trigger.validateWebhook({} as any);
      expect(result).toBe(false);
    });
  });

  describe('parseWebhook', () => {
    it('should parse valid webhook payload', async () => {
      const payload = mockWebhookPayloads.mock.valid;
      const event = await trigger.parseWebhook(payload);

      expect(event).toBeTruthy();
      expect(event?.triggerType).toBe('mock');
      expect(event?.triggerId).toBe('mock-123');
      expect(event?.projectId).toBe('test-project');
      expect(event?.title).toBe('NullPointerException in UserService');
      expect(trigger.calls.parseWebhook).toBe(1);
    });

    it('should return null for invalid payload', async () => {
      const payload = mockWebhookPayloads.mock.invalid;
      const event = await trigger.parseWebhook(payload);

      expect(event).toBeNull();
    });

    it('should use configured event', async () => {
      const customEvent: TriggerEvent = {
        triggerType: 'custom',
        triggerId: 'custom-123',
        projectId: 'custom-project',
        title: 'Custom Event',
        description: 'Custom description',
        metadata: {},
        raw: {},
      };

      trigger.setEvent(customEvent);
      const event = await trigger.parseWebhook({});

      expect(event).toEqual(customEvent);
    });
  });

  describe('getTools', () => {
    it('should return default tools', () => {
      const event: TriggerEvent = {
        triggerType: 'mock',
        triggerId: 'test-123',
        projectId: 'test-project',
        title: 'Test',
        description: 'Test desc',
        metadata: {},
        raw: {},
      };

      const tools = trigger.getTools(event);

      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('get-issue');
      expect(tools[0].script).toContain('test-123');
      expect(trigger.calls.getTools).toBe(1);
    });

    it('should use configured tools', () => {
      const customTools = [
        {
          name: 'custom-tool',
          description: 'Custom tool',
          script: '#!/bin/bash\necho "custom"',
        },
      ];

      trigger.setTools(customTools);
      const tools = trigger.getTools({} as any);

      expect(tools).toEqual(customTools);
    });
  });

  describe('getPromptContext', () => {
    it('should generate prompt context', () => {
      const event: TriggerEvent = {
        triggerType: 'mock',
        triggerId: 'test-123',
        projectId: 'test-project',
        title: 'Test Issue',
        description: 'Test desc',
        metadata: {},
        raw: {},
      };

      const context = trigger.getPromptContext(event);

      expect(context).toContain('Test Issue');
      expect(context).toContain('test-123');
      expect(trigger.calls.getPromptContext).toBe(1);
    });
  });

  describe('updateStatus', () => {
    it('should track status updates', async () => {
      const event: TriggerEvent = {
        triggerType: 'mock',
        triggerId: 'test-123',
        projectId: 'test-project',
        title: 'Test',
        description: 'Test desc',
        metadata: {},
        raw: {},
      };

      const status = { fixed: true };

      await trigger.updateStatus(event, status);

      expect(trigger.calls.updateStatus).toBe(1);
      expect(trigger.lastStatusUpdate).toEqual({ event, status });
    });
  });

  describe('addComment', () => {
    it('should track comments', async () => {
      const event: TriggerEvent = {
        triggerType: 'mock',
        triggerId: 'test-123',
        projectId: 'test-project',
        title: 'Test',
        description: 'Test desc',
        metadata: {},
        raw: {},
      };

      const comment = 'Test comment';

      await trigger.addComment(event, comment);

      expect(trigger.calls.addComment).toBe(1);
      expect(trigger.lastComment).toEqual({ event, comment });
    });
  });

  describe('getLink', () => {
    it('should generate link markdown', () => {
      const event: TriggerEvent = {
        triggerType: 'mock',
        triggerId: 'test-123',
        projectId: 'test-project',
        title: 'Test',
        description: 'Test desc',
        metadata: {},
        links: {
          web: 'https://example.com/issues/123',
        },
        raw: {},
      };

      const link = trigger.getLink(event);

      expect(link).toContain('Mock Issue');
      expect(link).toContain('https://example.com/issues/123');
      expect(trigger.calls.getLink).toBe(1);
    });
  });

  describe('reset', () => {
    it('should reset all tracking state', async () => {
      const event: TriggerEvent = {
        triggerType: 'mock',
        triggerId: 'test-123',
        projectId: 'test-project',
        title: 'Test',
        description: 'Test desc',
        metadata: {},
        raw: {},
      };

      // Make some calls
      await trigger.validateWebhook({} as any);
      await trigger.updateStatus(event, { fixed: true });
      await trigger.addComment(event, 'Test');

      // Reset
      trigger.reset();

      // Check all counts are zero
      expect(trigger.calls.validateWebhook).toBe(0);
      expect(trigger.calls.updateStatus).toBe(0);
      expect(trigger.calls.addComment).toBe(0);
      expect(trigger.lastStatusUpdate).toBeUndefined();
      expect(trigger.lastComment).toBeUndefined();
    });
  });
});
