import { buildInvestigationPrompt, buildSimplePrompt } from '../../../src/runner/prompts';
import { createMockTrigger } from '../../mocks/mock-trigger';
import { TriggerEvent, Tool } from '../../../src/triggers/base';

describe('Prompts', () => {
  const mockEvent: TriggerEvent = {
    triggerType: 'mock',
    triggerId: 'test-123',
    projectId: 'test-project',
    title: 'NullPointerException in UserService',
    description: 'UserService.getUser() throws NPE',
    metadata: {
      severity: 'high',
    },
    raw: {},
  };

  describe('buildInvestigationPrompt', () => {
    it('should build prompt with tools', () => {
      const trigger = createMockTrigger();
      const tools: Tool[] = [
        {
          name: 'get-issue',
          description: 'Get issue details',
          script: '#!/bin/bash\necho "test"',
        },
        {
          name: 'get-logs',
          description: 'Get application logs',
          script: '#!/bin/bash\necho "logs"',
        },
      ];

      const prompt = buildInvestigationPrompt(trigger, mockEvent, tools);

      expect(prompt).toContain('Available Tools');
      expect(prompt).toContain('get-issue');
      expect(prompt).toContain('Get issue details');
      expect(prompt).toContain('get-logs');
      expect(prompt).toContain('Get application logs');
      expect(prompt).toContain('.claude/analysis.json');
      expect(prompt).toContain('canAutoFix');
      expect(prompt).toContain('confidence');
    });

    it('should build prompt without tools section when no tools', () => {
      const trigger = createMockTrigger();
      const tools: Tool[] = [];

      const prompt = buildInvestigationPrompt(trigger, mockEvent, tools);

      expect(prompt).not.toContain('Available Tools');
      expect(prompt).toContain('.claude/analysis.json');
      expect(prompt).toContain('Investigation Process');
    });

    it('should include source context', () => {
      const trigger = createMockTrigger();
      const tools: Tool[] = [];

      const prompt = buildInvestigationPrompt(trigger, mockEvent, tools);

      // Mock trigger includes issue ID in context
      expect(prompt).toContain('test-123');
      expect(prompt).toContain('NullPointerException');
    });

    it('should include decision criteria', () => {
      const trigger = createMockTrigger();
      const tools: Tool[] = [];

      const prompt = buildInvestigationPrompt(trigger, mockEvent, tools);

      expect(prompt).toContain('DO auto-fix if');
      expect(prompt).toContain("DON'T auto-fix if");
      expect(prompt).toContain('Type errors');
      expect(prompt).toContain('architectural changes');
    });

    it('should include output requirements', () => {
      const trigger = createMockTrigger();
      const tools: Tool[] = [];

      const prompt = buildInvestigationPrompt(trigger, mockEvent, tools);

      expect(prompt).toContain('Output Requirements');
      expect(prompt).toContain('analysis.json');
      expect(prompt).toContain('"canAutoFix"');
      expect(prompt).toContain('"confidence"');
      expect(prompt).toContain('"summary"');
      expect(prompt).toContain('"rootCause"');
      expect(prompt).toContain('"filesInvolved"');
    });
  });

  describe('buildSimplePrompt', () => {
    it('should build simple prompt', () => {
      const prompt = buildSimplePrompt(mockEvent);

      expect(prompt).toContain(mockEvent.title);
      expect(prompt).toContain(mockEvent.description);
      expect(prompt).toContain('.claude/analysis.json');
    });

    it('should be shorter than investigation prompt', () => {
      const trigger = createMockTrigger();
      const tools: Tool[] = [];

      const investigationPrompt = buildInvestigationPrompt(trigger, mockEvent, tools);
      const simplePrompt = buildSimplePrompt(mockEvent);

      expect(simplePrompt.length).toBeLessThan(investigationPrompt.length);
    });
  });
});
