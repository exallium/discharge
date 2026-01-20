/**
 * Tests for bug-config validation
 */

import {
  validateBugConfig,
  getSystemAgentDefaults,
  mergeWithSystemAgent,
  getAgentModel,
  getAgentDescription,
  getAvailableAgents,
  isSystemAgent,
  resolveRules,
  getAgentRules,
  getSentryConfig,
  getCircleCIConfig,
  getConfiguredServices,
  getSentryApiUrl,
  AiBugsConfig,
  SentryConfig,
} from '../../../src/runner/bug-config';
import { writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Bug Config', () => {
  describe('validateBugConfig', () => {
    it('should validate a minimal valid config', () => {
      const config = {
        version: '2',
      };

      const result = validateBugConfig(config);

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.config.version).toBe('2');
      }
    });

    it('should validate config with global rules', () => {
      const config = {
        version: '2',
        rules: [
          'Always run tests before committing.',
          { rulePath: 'CLAUDE.md' },
        ],
      };

      const result = validateBugConfig(config);

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.config.rules).toHaveLength(2);
      }
    });

    it('should validate config with agents', () => {
      const config = {
        version: '2',
        agents: {
          ui: {
            agentPath: '.claude/agents/UI.md',
            model: 'medium',
            description: 'Handles UI issues',
          },
          database: {
            model: 'large',
            rules: ['Always create migrations.'],
          },
        },
      };

      const result = validateBugConfig(config);

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.config.agents?.ui?.model).toBe('medium');
        expect(result.config.agents?.database?.model).toBe('large');
      }
    });

    it('should validate config with secondaryRepos in config object', () => {
      const config = {
        version: '2',
        config: {
          secondaryRepos: ['myorg/backend', 'myorg/types'],
        },
      };

      const result = validateBugConfig(config);

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.config.config?.secondaryRepos).toEqual(['myorg/backend', 'myorg/types']);
      }
    });

    it('should reject config without version', () => {
      const config = {
        rules: ['Test rule'],
      };

      const result = validateBugConfig(config);

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain('version');
      }
    });

    it('should reject config with invalid model', () => {
      const config = {
        version: '2',
        agents: {
          test: {
            model: 'gpt-4', // Invalid model
          },
        },
      };

      const result = validateBugConfig(config);

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain('invalid model');
      }
    });

    it('should reject config with empty rule string', () => {
      const config = {
        version: '2',
        rules: ['Valid rule', '   ', 'Another rule'],
      };

      const result = validateBugConfig(config);

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain('empty string');
      }
    });

    it('should reject config with invalid rulePath', () => {
      const config = {
        version: '2',
        rules: [{ rulePath: '' }],
      };

      const result = validateBugConfig(config);

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain('empty');
      }
    });

    it('should reject config with invalid secondaryRepos format', () => {
      const config = {
        version: '2',
        config: {
          secondaryRepos: ['invalid-repo-no-slash'],
        },
      };

      const result = validateBugConfig(config);

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain('Invalid repo format');
      }
    });
  });

  describe('System Agent Defaults', () => {
    it('should return all four system agents', () => {
      const defaults = getSystemAgentDefaults();

      expect(defaults.triage).toBeDefined();
      expect(defaults.investigate).toBeDefined();
      expect(defaults.simple).toBeDefined();
      expect(defaults.complex).toBeDefined();
    });

    it('should have correct model tiers', () => {
      const defaults = getSystemAgentDefaults();

      expect(defaults.triage.model).toBe('small');
      expect(defaults.investigate.model).toBe('medium');
      expect(defaults.simple.model).toBe('medium');
      expect(defaults.complex.model).toBe('large');
    });

    it('should have descriptions for all agents', () => {
      const defaults = getSystemAgentDefaults();

      for (const [name, agent] of Object.entries(defaults)) {
        expect(agent.description).toBeTruthy();
        expect(typeof agent.description).toBe('string');
      }
    });
  });

  describe('mergeWithSystemAgent', () => {
    it('should return user config as-is for non-system agent', () => {
      const userConfig = {
        model: 'large' as const,
        description: 'Custom agent',
        rules: ['Custom rule'],
      };

      const result = mergeWithSystemAgent('custom', userConfig, getSystemAgentDefaults());

      expect(result.isSystemAgent).toBe(false);
      expect(result.config).toEqual(userConfig);
    });

    it('should merge user config with system agent defaults', () => {
      const userConfig = {
        model: 'large' as const, // Override default
        rules: ['User rule'],
      };

      const result = mergeWithSystemAgent('simple', userConfig, getSystemAgentDefaults());

      expect(result.isSystemAgent).toBe(true);
      expect(result.config.model).toBe('large'); // User override
      expect(result.config.rules).toContain('User rule');
      // System rules should be included
      expect(result.config.rules?.some(r => typeof r === 'string' && r.includes('minimal'))).toBe(true);
    });

    it('should use system model if user does not override', () => {
      const userConfig = {
        rules: ['Extra rule'],
      };

      const result = mergeWithSystemAgent('complex', userConfig, getSystemAgentDefaults());

      expect(result.config.model).toBe('large'); // System default for complex
    });

    it('should preserve user agentPath', () => {
      const userConfig = {
        agentPath: '.claude/my-agent.md',
      };

      const result = mergeWithSystemAgent('simple', userConfig, getSystemAgentDefaults());

      expect(result.config.agentPath).toBe('.claude/my-agent.md');
    });
  });

  describe('getAgentModel', () => {
    it('should return system default for system agent', () => {
      expect(getAgentModel(undefined, 'triage')).toBe('small');
      expect(getAgentModel(undefined, 'investigate')).toBe('medium');
      expect(getAgentModel(undefined, 'simple')).toBe('medium');
      expect(getAgentModel(undefined, 'complex')).toBe('large');
    });

    it('should return user override if specified', () => {
      const config: AiBugsConfig = {
        version: '2',
        agents: {
          simple: { model: 'large' },
        },
      };

      expect(getAgentModel(config, 'simple')).toBe('large');
    });

    it('should return medium for unknown agent', () => {
      expect(getAgentModel(undefined, 'unknown')).toBe('medium');
    });
  });

  describe('getAgentDescription', () => {
    it('should return system description for system agent', () => {
      const description = getAgentDescription(undefined, 'triage');
      expect(description).toContain('categorization');
    });

    it('should return user description if specified', () => {
      const config: AiBugsConfig = {
        version: '2',
        agents: {
          triage: { description: 'My custom triage' },
        },
      };

      expect(getAgentDescription(config, 'triage')).toBe('My custom triage');
    });

    it('should return generic description for unknown agent', () => {
      const description = getAgentDescription(undefined, 'unknown');
      expect(description).toContain('unknown');
    });
  });

  describe('getAvailableAgents', () => {
    it('should return all system agents when no config', () => {
      const agents = getAvailableAgents(undefined);

      expect(agents.length).toBeGreaterThanOrEqual(4);
      expect(agents.some(a => a.name === 'triage')).toBe(true);
      expect(agents.some(a => a.name === 'investigate')).toBe(true);
      expect(agents.some(a => a.name === 'simple')).toBe(true);
      expect(agents.some(a => a.name === 'complex')).toBe(true);
    });

    it('should include user-defined agents', () => {
      const config: AiBugsConfig = {
        version: '2',
        agents: {
          ui: { description: 'UI agent', model: 'medium' },
          database: { description: 'DB agent', model: 'large' },
        },
      };

      const agents = getAvailableAgents(config);

      expect(agents.some(a => a.name === 'ui' && !a.isSystem)).toBe(true);
      expect(agents.some(a => a.name === 'database' && !a.isSystem)).toBe(true);
    });

    it('should mark system agents as isSystem=true', () => {
      const agents = getAvailableAgents(undefined);

      const triage = agents.find(a => a.name === 'triage');
      expect(triage?.isSystem).toBe(true);
    });
  });

  describe('isSystemAgent', () => {
    it('should return true for system agents', () => {
      expect(isSystemAgent('triage')).toBe(true);
      expect(isSystemAgent('investigate')).toBe(true);
      expect(isSystemAgent('simple')).toBe(true);
      expect(isSystemAgent('complex')).toBe(true);
    });

    it('should return false for non-system agents', () => {
      expect(isSystemAgent('ui')).toBe(false);
      expect(isSystemAgent('custom')).toBe(false);
    });
  });

  describe('resolveRules', () => {
    let testDir: string;

    beforeAll(async () => {
      testDir = join(tmpdir(), `bug-config-test-${Date.now()}`);
      await mkdir(testDir, { recursive: true });
    });

    afterAll(async () => {
      await rm(testDir, { recursive: true, force: true });
    });

    it('should resolve inline rules', async () => {
      const rules = ['Rule 1', 'Rule 2'];
      const resolved = await resolveRules(rules, testDir);

      expect(resolved).toHaveLength(2);
      expect(resolved[0].content).toBe('Rule 1');
      expect(resolved[0].source).toBe('inline');
    });

    it('should resolve file-based rules', async () => {
      const ruleContent = '# My Rules\n\n- Do this\n- Do that';
      await writeFile(join(testDir, 'RULES.md'), ruleContent);

      const rules = [{ rulePath: 'RULES.md' }];
      const resolved = await resolveRules(rules, testDir);

      expect(resolved).toHaveLength(1);
      expect(resolved[0].content).toBe(ruleContent.trim());
      expect(resolved[0].source).toBe('RULES.md');
    });

    it('should handle missing rule files gracefully', async () => {
      const rules = [{ rulePath: 'NONEXISTENT.md' }];
      const resolved = await resolveRules(rules, testDir);

      expect(resolved).toHaveLength(1);
      expect(resolved[0].content).toContain('not found');
      expect(resolved[0].source).toBe('NONEXISTENT.md');
    });

    it('should return empty array for undefined rules', async () => {
      const resolved = await resolveRules(undefined, testDir);
      expect(resolved).toHaveLength(0);
    });
  });

  describe('getAgentRules', () => {
    let testDir: string;

    beforeAll(async () => {
      testDir = join(tmpdir(), `bug-config-agent-test-${Date.now()}`);
      await mkdir(testDir, { recursive: true });
      await writeFile(join(testDir, 'CLAUDE.md'), '# Claude Rules');
    });

    afterAll(async () => {
      await rm(testDir, { recursive: true, force: true });
    });

    it('should include global and agent rules', async () => {
      const config: AiBugsConfig = {
        version: '2',
        rules: ['Global rule'],
        agents: {
          simple: {
            rules: ['Agent-specific rule'],
          },
        },
      };

      const rules = await getAgentRules(config, 'simple', testDir);

      // Should have global rule + system rules + agent rule
      expect(rules.some(r => r.content === 'Global rule')).toBe(true);
      expect(rules.some(r => r.content === 'Agent-specific rule')).toBe(true);
    });

    it('should include system rules for system agents', async () => {
      const config: AiBugsConfig = {
        version: '2',
      };

      const rules = await getAgentRules(config, 'simple', testDir);

      // Should have system rules
      expect(rules.some(r => r.content.includes('minimal'))).toBe(true);
    });

    it('should load agent path content', async () => {
      await writeFile(join(testDir, 'agent.md'), 'Agent file content');

      const config: AiBugsConfig = {
        version: '2',
        agents: {
          custom: {
            agentPath: 'agent.md',
          },
        },
      };

      const rules = await getAgentRules(config, 'custom', testDir);

      expect(rules.some(r => r.content === 'Agent file content')).toBe(true);
    });
  });

  describe('Sentry Config Validation', () => {
    it('should validate a valid sentry config', () => {
      const config = {
        version: '2',
        config: {
          sentry: {
            organization: 'my-org',
            project: 'my-project',
          },
        },
      };

      const result = validateBugConfig(config);

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.config.config?.sentry?.organization).toBe('my-org');
        expect(result.config.config?.sentry?.project).toBe('my-project');
      }
    });

    it('should validate sentry config with custom instanceUrl', () => {
      const config = {
        version: '2',
        config: {
          sentry: {
            organization: 'my-org',
            project: 'my-project',
            instanceUrl: 'https://sentry.mycompany.com',
          },
        },
      };

      const result = validateBugConfig(config);

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.config.config?.sentry?.instanceUrl).toBe('https://sentry.mycompany.com');
      }
    });

    it('should reject sentry config without organization', () => {
      const config = {
        version: '2',
        config: {
          sentry: {
            project: 'my-project',
          },
        },
      };

      const result = validateBugConfig(config);

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain('config.sentry.organization');
      }
    });

    it('should reject sentry config without project', () => {
      const config = {
        version: '2',
        config: {
          sentry: {
            organization: 'my-org',
          },
        },
      };

      const result = validateBugConfig(config);

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain('config.sentry.project');
      }
    });

    it('should reject sentry config with empty organization', () => {
      const config = {
        version: '2',
        config: {
          sentry: {
            organization: '   ',
            project: 'my-project',
          },
        },
      };

      const result = validateBugConfig(config);

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain('config.sentry.organization');
      }
    });

    it('should reject sentry config with invalid instanceUrl', () => {
      const config = {
        version: '2',
        config: {
          sentry: {
            organization: 'my-org',
            project: 'my-project',
            instanceUrl: 'not-a-valid-url',
          },
        },
      };

      const result = validateBugConfig(config);

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain('config.sentry.instanceUrl');
        expect(result.error).toContain('not a valid URL');
      }
    });

    it('should allow sentry config alongside other config options', () => {
      const config = {
        version: '2',
        config: {
          secondaryRepos: ['myorg/backend'],
          sentry: {
            organization: 'my-org',
            project: 'my-project',
          },
        },
      };

      const result = validateBugConfig(config);

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.config.config?.secondaryRepos).toEqual(['myorg/backend']);
        expect(result.config.config?.sentry?.organization).toBe('my-org');
      }
    });
  });

  describe('CircleCI Config Validation', () => {
    it('should validate a valid circleci config', () => {
      const config = {
        version: '2',
        config: {
          circleci: {
            project: 'gh/my-org/my-repo',
          },
        },
      };

      const result = validateBugConfig(config);

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.config.config?.circleci?.project).toBe('gh/my-org/my-repo');
      }
    });

    it('should validate circleci config with custom configPath', () => {
      const config = {
        version: '2',
        config: {
          circleci: {
            project: 'gh/my-org/my-repo',
            configPath: '.circleci/custom-config.yml',
          },
        },
      };

      const result = validateBugConfig(config);

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.config.config?.circleci?.configPath).toBe('.circleci/custom-config.yml');
      }
    });

    it('should reject circleci config without project', () => {
      const config = {
        version: '2',
        config: {
          circleci: {
            configPath: '.circleci/config.yml',
          },
        },
      };

      const result = validateBugConfig(config);

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain('config.circleci.project');
      }
    });

    it('should reject circleci config with empty project', () => {
      const config = {
        version: '2',
        config: {
          circleci: {
            project: '',
          },
        },
      };

      const result = validateBugConfig(config);

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain('config.circleci.project');
      }
    });
  });

  describe('Combined Service Configs', () => {
    it('should validate config with both sentry and circleci', () => {
      const config = {
        version: '2',
        config: {
          sentry: {
            organization: 'my-org',
            project: 'my-sentry-project',
          },
          circleci: {
            project: 'gh/my-org/my-repo',
          },
        },
      };

      const result = validateBugConfig(config);

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.config.config?.sentry?.organization).toBe('my-org');
        expect(result.config.config?.circleci?.project).toBe('gh/my-org/my-repo');
      }
    });

    it('should validate full config with rules, agents, and services', () => {
      const config = {
        version: '2',
        rules: ['Always run tests'],
        agents: {
          simple: { model: 'large' },
        },
        config: {
          secondaryRepos: ['myorg/shared'],
          sentry: {
            organization: 'my-org',
            project: 'my-project',
            instanceUrl: 'https://sentry.internal.com',
          },
          circleci: {
            project: 'gh/my-org/my-repo',
          },
        },
      };

      const result = validateBugConfig(config);

      expect(result.valid).toBe(true);
    });
  });

  describe('getSentryConfig', () => {
    it('should return sentry config when present', () => {
      const config: AiBugsConfig = {
        version: '2',
        config: {
          sentry: {
            organization: 'my-org',
            project: 'my-project',
          },
        },
      };

      const sentry = getSentryConfig(config);

      expect(sentry).toBeDefined();
      expect(sentry?.organization).toBe('my-org');
      expect(sentry?.project).toBe('my-project');
    });

    it('should return undefined when sentry not configured', () => {
      const config: AiBugsConfig = {
        version: '2',
      };

      const sentry = getSentryConfig(config);

      expect(sentry).toBeUndefined();
    });

    it('should return undefined for undefined config', () => {
      const sentry = getSentryConfig(undefined);

      expect(sentry).toBeUndefined();
    });
  });

  describe('getCircleCIConfig', () => {
    it('should return circleci config when present', () => {
      const config: AiBugsConfig = {
        version: '2',
        config: {
          circleci: {
            project: 'gh/my-org/my-repo',
            configPath: '.circleci/config.yml',
          },
        },
      };

      const circleci = getCircleCIConfig(config);

      expect(circleci).toBeDefined();
      expect(circleci?.project).toBe('gh/my-org/my-repo');
      expect(circleci?.configPath).toBe('.circleci/config.yml');
    });

    it('should return undefined when circleci not configured', () => {
      const config: AiBugsConfig = {
        version: '2',
      };

      const circleci = getCircleCIConfig(config);

      expect(circleci).toBeUndefined();
    });
  });

  describe('getConfiguredServices', () => {
    it('should return empty array when no config', () => {
      const services = getConfiguredServices(undefined);

      expect(services).toEqual([]);
    });

    it('should return empty array when config has no services', () => {
      const config: AiBugsConfig = {
        version: '2',
        config: {
          secondaryRepos: ['myorg/repo'],
        },
      };

      const services = getConfiguredServices(config);

      expect(services).toEqual([]);
    });

    it('should return sentry when only sentry configured', () => {
      const config: AiBugsConfig = {
        version: '2',
        config: {
          sentry: {
            organization: 'my-org',
            project: 'my-project',
          },
        },
      };

      const services = getConfiguredServices(config);

      expect(services).toEqual(['sentry']);
    });

    it('should return both services when both configured', () => {
      const config: AiBugsConfig = {
        version: '2',
        config: {
          sentry: {
            organization: 'my-org',
            project: 'my-project',
          },
          circleci: {
            project: 'gh/my-org/my-repo',
          },
        },
      };

      const services = getConfiguredServices(config);

      expect(services).toContain('sentry');
      expect(services).toContain('circleci');
      expect(services).toHaveLength(2);
    });
  });

  describe('getSentryApiUrl', () => {
    it('should return default sentry.io URL when no instanceUrl', () => {
      const sentryConfig: SentryConfig = {
        organization: 'my-org',
        project: 'my-project',
      };

      const url = getSentryApiUrl(sentryConfig);

      expect(url).toBe('https://sentry.io');
    });

    it('should return custom instanceUrl when provided', () => {
      const sentryConfig: SentryConfig = {
        organization: 'my-org',
        project: 'my-project',
        instanceUrl: 'https://sentry.mycompany.com',
      };

      const url = getSentryApiUrl(sentryConfig);

      expect(url).toBe('https://sentry.mycompany.com');
    });

    it('should strip trailing slash from instanceUrl', () => {
      const sentryConfig: SentryConfig = {
        organization: 'my-org',
        project: 'my-project',
        instanceUrl: 'https://sentry.mycompany.com/',
      };

      const url = getSentryApiUrl(sentryConfig);

      expect(url).toBe('https://sentry.mycompany.com');
    });
  });
});
