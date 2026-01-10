import { createMockSource, MockSource } from '../../mocks/mock-source';
import { mockWebhookPayloads } from '../../fixtures/webhook-payloads';
import { SourceEvent } from '../../../src/sources/base';

describe('MockSource', () => {
  let source: MockSource;

  beforeEach(() => {
    source = createMockSource();
  });

  describe('validateWebhook', () => {
    it('should validate webhook by default', async () => {
      const result = await source.validateWebhook({} as any);
      expect(result).toBe(true);
      expect(source.calls.validateWebhook).toBe(1);
    });

    it('should allow configuration of validation result', async () => {
      source.setValidation(false);
      const result = await source.validateWebhook({} as any);
      expect(result).toBe(false);
    });
  });

  describe('parseWebhook', () => {
    it('should parse valid webhook payload', async () => {
      const payload = mockWebhookPayloads.mock.valid;
      const event = await source.parseWebhook(payload);

      expect(event).toBeTruthy();
      expect(event?.sourceType).toBe('mock');
      expect(event?.sourceId).toBe('mock-123');
      expect(event?.projectId).toBe('test-project');
      expect(event?.title).toBe('NullPointerException in UserService');
      expect(source.calls.parseWebhook).toBe(1);
    });

    it('should return null for invalid payload', async () => {
      const payload = mockWebhookPayloads.mock.invalid;
      const event = await source.parseWebhook(payload);

      expect(event).toBeNull();
    });

    it('should use configured event', async () => {
      const customEvent: SourceEvent = {
        sourceType: 'custom',
        sourceId: 'custom-123',
        projectId: 'custom-project',
        title: 'Custom Event',
        description: 'Custom description',
        metadata: {},
        raw: {},
      };

      source.setEvent(customEvent);
      const event = await source.parseWebhook({});

      expect(event).toEqual(customEvent);
    });
  });

  describe('getTools', () => {
    it('should return default tools', () => {
      const event: SourceEvent = {
        sourceType: 'mock',
        sourceId: 'test-123',
        projectId: 'test-project',
        title: 'Test',
        description: 'Test desc',
        metadata: {},
        raw: {},
      };

      const tools = source.getTools(event);

      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('get-issue');
      expect(tools[0].script).toContain('test-123');
      expect(source.calls.getTools).toBe(1);
    });

    it('should use configured tools', () => {
      const customTools = [
        {
          name: 'custom-tool',
          description: 'Custom tool',
          script: '#!/bin/bash\necho "custom"',
        },
      ];

      source.setTools(customTools);
      const tools = source.getTools({} as any);

      expect(tools).toEqual(customTools);
    });
  });

  describe('getPromptContext', () => {
    it('should generate prompt context', () => {
      const event: SourceEvent = {
        sourceType: 'mock',
        sourceId: 'test-123',
        projectId: 'test-project',
        title: 'Test Issue',
        description: 'Test desc',
        metadata: {},
        raw: {},
      };

      const context = source.getPromptContext(event);

      expect(context).toContain('Test Issue');
      expect(context).toContain('test-123');
      expect(source.calls.getPromptContext).toBe(1);
    });
  });

  describe('updateStatus', () => {
    it('should track status updates', async () => {
      const event: SourceEvent = {
        sourceType: 'mock',
        sourceId: 'test-123',
        projectId: 'test-project',
        title: 'Test',
        description: 'Test desc',
        metadata: {},
        raw: {},
      };

      const status = { fixed: true };

      await source.updateStatus(event, status);

      expect(source.calls.updateStatus).toBe(1);
      expect(source.lastStatusUpdate).toEqual({ event, status });
    });
  });

  describe('addComment', () => {
    it('should track comments', async () => {
      const event: SourceEvent = {
        sourceType: 'mock',
        sourceId: 'test-123',
        projectId: 'test-project',
        title: 'Test',
        description: 'Test desc',
        metadata: {},
        raw: {},
      };

      const comment = 'Test comment';

      await source.addComment(event, comment);

      expect(source.calls.addComment).toBe(1);
      expect(source.lastComment).toEqual({ event, comment });
    });
  });

  describe('getLink', () => {
    it('should generate link markdown', () => {
      const event: SourceEvent = {
        sourceType: 'mock',
        sourceId: 'test-123',
        projectId: 'test-project',
        title: 'Test',
        description: 'Test desc',
        metadata: {},
        links: {
          web: 'https://example.com/issues/123',
        },
        raw: {},
      };

      const link = source.getLink(event);

      expect(link).toContain('Mock Issue');
      expect(link).toContain('https://example.com/issues/123');
      expect(source.calls.getLink).toBe(1);
    });
  });

  describe('reset', () => {
    it('should reset all tracking state', async () => {
      const event: SourceEvent = {
        sourceType: 'mock',
        sourceId: 'test-123',
        projectId: 'test-project',
        title: 'Test',
        description: 'Test desc',
        metadata: {},
        raw: {},
      };

      // Make some calls
      await source.validateWebhook({} as any);
      await source.updateStatus(event, { fixed: true });
      await source.addComment(event, 'Test');

      // Reset
      source.reset();

      // Check all counts are zero
      expect(source.calls.validateWebhook).toBe(0);
      expect(source.calls.updateStatus).toBe(0);
      expect(source.calls.addComment).toBe(0);
      expect(source.lastStatusUpdate).toBeUndefined();
      expect(source.lastComment).toBeUndefined();
    });
  });
});
