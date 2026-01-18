import {
  buildInvestigationPrompt,
  buildSimplePrompt,
  buildSecondaryReposSection,
  buildCategoryPrompt,
  buildTriagePrompt,
  buildAgentPrompt,
  buildInvestigationHandoffSection,
  buildPromptWithConfig,
} from '../../../src/runner/prompts';
import { createMockTrigger } from '../../mocks/mock-trigger';
import { TriggerEvent, Tool } from '../../../src/triggers/base';
import { BugFixConfig, AiBugsConfig, ResolvedRule, InvestigationContext } from '../../../src/runner/bug-config';

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

  describe('buildSecondaryReposSection', () => {
    it('should return empty string for no secondary repos', () => {
      const result = buildSecondaryReposSection('myorg/main', []);
      expect(result).toBe('');
    });

    it('should build section with secondary repos info', () => {
      const result = buildSecondaryReposSection('myorg/main', ['myorg/backend', 'myorg/shared-lib']);

      expect(result).toContain('Available Repositories');
      expect(result).toContain('Main Repository');
      expect(result).toContain('myorg/main');
      expect(result).toContain('Secondary Repositories');
      expect(result).toContain('myorg/backend');
      expect(result).toContain('/workspace-secondary/backend');
      expect(result).toContain('myorg/shared-lib');
      expect(result).toContain('/workspace-secondary/shared-lib');
    });

    it('should include targetRepo instructions', () => {
      const result = buildSecondaryReposSection('myorg/main', ['myorg/backend']);

      expect(result).toContain('targetRepo');
      expect(result).toContain('owner/repo-name');
      expect(result).toContain('analysis.json');
    });
  });

  describe('buildCategoryPrompt', () => {
    const basePrompt = 'Test base prompt';

    it('should return base prompt when no bugConfig', () => {
      const result = buildCategoryPrompt(basePrompt, undefined, []);
      expect(result).toBe(basePrompt);
    });

    it('should return base prompt when no categories', () => {
      const bugConfig: BugFixConfig = {
        version: '1.0',
        categories: {},
      };
      const result = buildCategoryPrompt(basePrompt, bugConfig, []);
      expect(result).toBe(basePrompt);
    });

    it('should add category requirements to prompt', () => {
      const bugConfig: BugFixConfig = {
        version: '1.0',
        categories: {
          default: {
            requirements: ['Must not break tests', 'Follow code style'],
            deliverables: ['Fix the bug'],
            testCommand: 'npm test',
          },
        },
      };

      const result = buildCategoryPrompt(basePrompt, bugConfig, []);

      expect(result).toContain(basePrompt);
      expect(result).toContain('Project-Specific Requirements');
      expect(result).toContain('Must not break tests');
      expect(result).toContain('Follow code style');
      expect(result).toContain('Required Deliverables');
      expect(result).toContain('Fix the bug');
      expect(result).toContain('npm test');
    });

    it('should match category by label', () => {
      const bugConfig: BugFixConfig = {
        version: '1.0',
        categories: {
          database: {
            match: { labels: ['db', 'database'] },
            requirements: ['Use parameterized queries'],
            deliverables: ['Fix DB issue'],
            testCommand: 'npm run test:db',
          },
          default: {
            requirements: ['Generic requirement'],
            deliverables: ['Generic fix'],
            testCommand: 'npm test',
          },
        },
      };

      const result = buildCategoryPrompt(basePrompt, bugConfig, ['db']);

      expect(result).toContain('Use parameterized queries');
      expect(result).toContain('npm run test:db');
      expect(result).not.toContain('Generic requirement');
    });

    it('should add secondary repos section when configured', () => {
      const bugConfig: BugFixConfig = {
        version: '1.0',
        secondaryRepos: ['myorg/backend', 'myorg/types'],
        categories: {
          default: {
            requirements: ['Test requirement'],
            deliverables: ['Test deliverable'],
            testCommand: 'npm test',
          },
        },
      };

      const result = buildCategoryPrompt(basePrompt, bugConfig, [], 'myorg/main');

      expect(result).toContain(basePrompt);
      expect(result).toContain('Available Repositories');
      expect(result).toContain('myorg/main');
      expect(result).toContain('myorg/backend');
      expect(result).toContain('/workspace-secondary/backend');
      expect(result).toContain('myorg/types');
    });

    it('should not add secondary repos section without mainRepoFullName', () => {
      const bugConfig: BugFixConfig = {
        version: '1.0',
        secondaryRepos: ['myorg/backend'],
        categories: {
          default: {
            requirements: ['Test requirement'],
            deliverables: ['Test deliverable'],
            testCommand: 'npm test',
          },
        },
      };

      const result = buildCategoryPrompt(basePrompt, bugConfig, []);

      expect(result).not.toContain('Available Repositories');
      expect(result).not.toContain('/workspace-secondary');
    });

    it('should add secondary repos even without matching category', () => {
      const bugConfig: BugFixConfig = {
        version: '1.0',
        secondaryRepos: ['myorg/backend'],
        categories: {}, // Empty categories
      };

      const result = buildCategoryPrompt(basePrompt, bugConfig, [], 'myorg/main');

      expect(result).toContain(basePrompt);
      expect(result).toContain('Available Repositories');
      expect(result).toContain('myorg/backend');
    });
  });

  // =========================================================================
  // Version 2: Agent-Based Prompts
  // =========================================================================

  describe('buildTriagePrompt', () => {
    it('should build triage prompt with issue context', () => {
      const trigger = createMockTrigger();
      const config: AiBugsConfig = {
        version: '2',
      };

      const prompt = buildTriagePrompt(trigger, mockEvent, config);

      expect(prompt).toContain('triage agent');
      expect(prompt).toContain('NullPointerException');
      expect(prompt).toContain('actionable');
      expect(prompt).toContain('trivial');
      expect(prompt).toContain('triage-result.json');
    });

    it('should list available agents', () => {
      const trigger = createMockTrigger();
      const config: AiBugsConfig = {
        version: '2',
        agents: {
          ui: { description: 'Handles UI issues', model: 'sonnet' },
        },
      };

      const prompt = buildTriagePrompt(trigger, mockEvent, config);

      expect(prompt).toContain('investigate');
      expect(prompt).toContain('simple');
      expect(prompt).toContain('complex');
      expect(prompt).toContain('ui');
      expect(prompt).toContain('Handles UI issues');
    });

    it('should not list triage agent in available agents', () => {
      const trigger = createMockTrigger();

      const prompt = buildTriagePrompt(trigger, mockEvent, undefined);

      // Should not list triage as an option to route to
      const agentsSection = prompt.split('Available Agents')[1]?.split('Your Task')[0] || '';
      expect(agentsSection).not.toContain('**triage**');
    });
  });

  describe('buildAgentPrompt', () => {
    const tools: Tool[] = [
      {
        name: 'get-issue',
        description: 'Get issue details',
        script: '#!/bin/bash\necho "test"',
      },
    ];

    const resolvedRules: ResolvedRule[] = [
      { content: 'Always run tests.', source: 'inline' },
      { content: '# Guidelines\n\nBe thorough.', source: 'CLAUDE.md' },
    ];

    it('should build investigate agent prompt', () => {
      const trigger = createMockTrigger();

      const prompt = buildAgentPrompt(
        'investigate',
        trigger,
        mockEvent,
        resolvedRules,
        tools
      );

      expect(prompt).toContain('investigation agent');
      expect(prompt).toContain('NullPointerException');
      expect(prompt).toContain('get-issue');
      expect(prompt).toContain('Always run tests');
      expect(prompt).toContain('From CLAUDE.md');
      expect(prompt).toContain('investigation.json');
      expect(prompt).toContain('Do NOT make any code changes');
    });

    it('should build simple agent prompt', () => {
      const trigger = createMockTrigger();

      const prompt = buildAgentPrompt(
        'simple',
        trigger,
        mockEvent,
        resolvedRules,
        tools
      );

      expect(prompt).toContain('fix agent');
      expect(prompt).toContain('straightforward');
      expect(prompt).toContain('analysis.json');
      expect(prompt).toContain('DO auto-fix if');
    });

    it('should build complex agent prompt', () => {
      const trigger = createMockTrigger();

      const prompt = buildAgentPrompt(
        'complex',
        trigger,
        mockEvent,
        resolvedRules,
        tools
      );

      expect(prompt).toContain('fix agent');
      expect(prompt).toContain('complex implementation');
      expect(prompt).toContain('Plan Approach');
      expect(prompt).toContain('analysis.json');
    });

    it('should include investigation context when provided', () => {
      const trigger = createMockTrigger();
      const investigation: InvestigationContext = {
        rootCause: 'Missing null check in UserService.getUser()',
        filesInvolved: ['src/services/UserService.ts'],
        suggestedApproach: 'Add null check before accessing user properties',
        summary: 'The function assumes user is always defined',
      };

      const prompt = buildAgentPrompt(
        'simple',
        trigger,
        mockEvent,
        resolvedRules,
        tools,
        investigation
      );

      expect(prompt).toContain('Prior Investigation');
      expect(prompt).toContain('AI-generated, may be inaccurate');
      expect(prompt).toContain('Missing null check');
      expect(prompt).toContain('src/services/UserService.ts');
      expect(prompt).toContain('Add null check');
    });

    it('should include secondary repos section', () => {
      const trigger = createMockTrigger();

      const prompt = buildAgentPrompt(
        'simple',
        trigger,
        mockEvent,
        resolvedRules,
        tools,
        undefined,
        'myorg/main',
        ['myorg/backend', 'myorg/types']
      );

      expect(prompt).toContain('Available Repositories');
      expect(prompt).toContain('myorg/main');
      expect(prompt).toContain('myorg/backend');
    });

    it('should handle custom agent names', () => {
      const trigger = createMockTrigger();

      const prompt = buildAgentPrompt(
        'database',
        trigger,
        mockEvent,
        resolvedRules,
        tools
      );

      expect(prompt).toContain('database agent');
    });
  });

  describe('buildInvestigationHandoffSection', () => {
    it('should format investigation context correctly', () => {
      const investigation: InvestigationContext = {
        rootCause: 'Race condition in auth flow',
        filesInvolved: ['src/auth/login.ts', 'src/auth/session.ts'],
        suggestedApproach: 'Add mutex lock around session creation',
        summary: 'Multiple concurrent login attempts can create duplicate sessions',
      };

      const section = buildInvestigationHandoffSection(investigation);

      expect(section).toContain('Prior Investigation');
      expect(section).toContain('AI-generated, may be inaccurate');
      expect(section).toContain('Race condition');
      expect(section).toContain('src/auth/login.ts');
      expect(section).toContain('src/auth/session.ts');
      expect(section).toContain('mutex lock');
      expect(section).toContain('duplicate sessions');
    });

    it('should work without summary', () => {
      const investigation: InvestigationContext = {
        rootCause: 'Type mismatch',
        filesInvolved: ['src/types.ts'],
        suggestedApproach: 'Update type definition',
      };

      const section = buildInvestigationHandoffSection(investigation);

      expect(section).toContain('Type mismatch');
      expect(section).not.toContain('Full Summary');
    });
  });

  describe('buildPromptWithConfig', () => {
    it('should use v2 agent prompt when v2 config and agent name provided', () => {
      const trigger = createMockTrigger();
      const config: AiBugsConfig = {
        version: '2',
        rules: ['Test rule'],
      };
      const resolvedRules: ResolvedRule[] = [
        { content: 'Test rule', source: 'inline' },
      ];

      const prompt = buildPromptWithConfig(
        trigger,
        mockEvent,
        [],
        config,
        resolvedRules,
        { agentName: 'simple', isV2Config: true }
      );

      expect(prompt).toContain('fix agent');
      expect(prompt).toContain('Test rule');
    });

    it('should fall back to v1 category prompt when no agent name', () => {
      const trigger = createMockTrigger();
      const config: BugFixConfig = {
        version: '1.0',
        categories: {
          default: {
            requirements: ['V1 requirement'],
            deliverables: ['V1 deliverable'],
            testCommand: 'npm test',
          },
        },
      };

      const prompt = buildPromptWithConfig(
        trigger,
        mockEvent,
        [],
        config,
        [],
        { isV2Config: false }
      );

      expect(prompt).toContain('V1 requirement');
      expect(prompt).toContain('V1 deliverable');
    });

    it('should include investigation context for v2 prompts', () => {
      const trigger = createMockTrigger();
      const config: AiBugsConfig = { version: '2' };
      const investigation: InvestigationContext = {
        rootCause: 'Bug in parser',
        filesInvolved: ['src/parser.ts'],
        suggestedApproach: 'Fix the regex',
      };

      const prompt = buildPromptWithConfig(
        trigger,
        mockEvent,
        [],
        config,
        [],
        {
          agentName: 'simple',
          isV2Config: true,
          investigationContext: investigation,
        }
      );

      expect(prompt).toContain('Prior Investigation');
      expect(prompt).toContain('Bug in parser');
    });
  });
});
