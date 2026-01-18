/**
 * Tests for bug-config validation (v2 schema)
 */

import {
  validateBugConfig,
  validateLegacyConfig,
  validateConfig,
  isLegacyConfig,
  findMatchingCategory,
  getSystemAgentDefaults,
  mergeWithSystemAgent,
  getAgentModel,
  getAgentDescription,
  getAvailableAgents,
  isSystemAgent,
  resolveRules,
  getAgentRules,
  AiBugsConfig,
  BugFixConfig,
} from '../../../src/runner/bug-config';
import { writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Bug Config v2', () => {
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
            model: 'sonnet',
            description: 'Handles UI issues',
          },
          database: {
            model: 'opus',
            rules: ['Always create migrations.'],
          },
        },
      };

      const result = validateBugConfig(config);

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.config.agents?.ui?.model).toBe('sonnet');
        expect(result.config.agents?.database?.model).toBe('opus');
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

      expect(defaults.triage.model).toBe('haiku');
      expect(defaults.investigate.model).toBe('sonnet');
      expect(defaults.simple.model).toBe('sonnet');
      expect(defaults.complex.model).toBe('opus');
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
        model: 'opus' as const,
        description: 'Custom agent',
        rules: ['Custom rule'],
      };

      const result = mergeWithSystemAgent('custom', userConfig, getSystemAgentDefaults());

      expect(result.isSystemAgent).toBe(false);
      expect(result.config).toEqual(userConfig);
    });

    it('should merge user config with system agent defaults', () => {
      const userConfig = {
        model: 'opus' as const, // Override default
        rules: ['User rule'],
      };

      const result = mergeWithSystemAgent('simple', userConfig, getSystemAgentDefaults());

      expect(result.isSystemAgent).toBe(true);
      expect(result.config.model).toBe('opus'); // User override
      expect(result.config.rules).toContain('User rule');
      // System rules should be included
      expect(result.config.rules?.some(r => typeof r === 'string' && r.includes('minimal'))).toBe(true);
    });

    it('should use system model if user does not override', () => {
      const userConfig = {
        rules: ['Extra rule'],
      };

      const result = mergeWithSystemAgent('complex', userConfig, getSystemAgentDefaults());

      expect(result.config.model).toBe('opus'); // System default for complex
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
      expect(getAgentModel(undefined, 'triage')).toBe('haiku');
      expect(getAgentModel(undefined, 'investigate')).toBe('sonnet');
      expect(getAgentModel(undefined, 'simple')).toBe('sonnet');
      expect(getAgentModel(undefined, 'complex')).toBe('opus');
    });

    it('should return user override if specified', () => {
      const config: AiBugsConfig = {
        version: '2',
        agents: {
          simple: { model: 'opus' },
        },
      };

      expect(getAgentModel(config, 'simple')).toBe('opus');
    });

    it('should return sonnet for unknown agent', () => {
      expect(getAgentModel(undefined, 'unknown')).toBe('sonnet');
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
          ui: { description: 'UI agent', model: 'sonnet' },
          database: { description: 'DB agent', model: 'opus' },
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
});

describe('Bug Config v1 (Legacy)', () => {
  describe('validateLegacyConfig', () => {
    it('should validate a minimal valid v1 config', () => {
      const config = {
        version: '1.0',
        categories: {
          default: {
            requirements: ['Must not break tests'],
            deliverables: ['Fix the bug'],
            testCommand: 'npm test',
          },
        },
      };

      const result = validateLegacyConfig(config);

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.config.version).toBe('1.0');
      }
    });

    it('should reject config without categories', () => {
      const config = {
        version: '1.0',
      };

      const result = validateLegacyConfig(config);

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain('categories');
      }
    });

    it('should validate secondaryRepos', () => {
      const config = {
        version: '1.0',
        secondaryRepos: ['myorg/backend'],
        categories: {
          default: {
            requirements: ['Test'],
            deliverables: ['Fix'],
            testCommand: 'npm test',
          },
        },
      };

      const result = validateLegacyConfig(config);

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.config.secondaryRepos).toEqual(['myorg/backend']);
      }
    });
  });

  describe('isLegacyConfig', () => {
    it('should return true for v1 config with categories', () => {
      const config = {
        version: '1.0',
        categories: { default: {} },
      };

      expect(isLegacyConfig(config)).toBe(true);
    });

    it('should return false for v2 config', () => {
      const config = {
        version: '2',
        rules: ['Test'],
      };

      expect(isLegacyConfig(config)).toBe(false);
    });

    it('should return false for non-object', () => {
      expect(isLegacyConfig(null)).toBe(false);
      expect(isLegacyConfig('string')).toBe(false);
    });
  });

  describe('findMatchingCategory', () => {
    it('should return default category when no labels match', () => {
      const categories = {
        database: {
          match: { labels: ['db', 'database'] },
          requirements: ['DB req'],
          deliverables: ['DB fix'],
          testCommand: 'npm run test:db',
        },
        default: {
          requirements: ['Default req'],
          deliverables: ['Default fix'],
          testCommand: 'npm test',
        },
      };

      const result = findMatchingCategory(categories, ['ui', 'frontend']);

      expect(result?.requirements).toEqual(['Default req']);
    });

    it('should return matching category when label matches', () => {
      const categories = {
        database: {
          match: { labels: ['db', 'database'] },
          requirements: ['DB req'],
          deliverables: ['DB fix'],
          testCommand: 'npm run test:db',
        },
        default: {
          requirements: ['Default req'],
          deliverables: ['Default fix'],
          testCommand: 'npm test',
        },
      };

      const result = findMatchingCategory(categories, ['db']);

      expect(result?.requirements).toEqual(['DB req']);
    });

    it('should match labels case-insensitively', () => {
      const categories = {
        database: {
          match: { labels: ['DB', 'Database'] },
          requirements: ['DB req'],
          deliverables: ['DB fix'],
          testCommand: 'npm run test:db',
        },
      };

      const result = findMatchingCategory(categories, ['db']);

      expect(result?.requirements).toEqual(['DB req']);
    });

    it('should return undefined when no categories', () => {
      const result = findMatchingCategory(undefined, ['db']);
      expect(result).toBeUndefined();
    });
  });
});

describe('validateConfig (smart validator)', () => {
  it('should detect and validate v1 config', () => {
    const config = {
      version: '1.0',
      categories: {
        default: {
          requirements: ['Test'],
          deliverables: ['Fix'],
          testCommand: 'npm test',
        },
      },
    };

    const result = validateConfig(config);

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.isV2).toBe(false);
    }
  });

  it('should detect and validate v2 config', () => {
    const config = {
      version: '2',
      rules: ['Test rule'],
    };

    const result = validateConfig(config);

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.isV2).toBe(true);
    }
  });

  it('should return error for invalid config', () => {
    const config = 'not an object';

    const result = validateConfig(config);

    expect(result.valid).toBe(false);
  });
});
