/**
 * Tests for triage-based orchestration
 */

import { orchestrateWithTriage } from '../../../src/runner/orchestrator';
import { TriggerPlugin, TriggerEvent, Tool } from '../../../src/triggers/base';
import { ProjectConfig } from '../../../src/config/projects';
import { RunnerPlugin, RunResult } from '../../../src/runner/base';
import { AiBugsConfig, TriageResult, InvestigationContext } from '../../../src/runner/bug-config';

// Mock dependencies
jest.mock('../../../src/vcs', () => ({
  getVCSForProject: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../../src/config/projects', () => ({
  findProjectById: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../../src/runner/bug-config', () => ({
  ...jest.requireActual('../../../src/runner/bug-config'),
  getAgentRules: jest.fn().mockResolvedValue([]),
}));

describe('Triage-Based Orchestration', () => {
  // Mock trigger
  const mockTrigger: TriggerPlugin = {
    id: 'test-trigger',
    type: 'test',
    name: 'Test Trigger',
    parseWebhook: jest.fn(),
    validateWebhook: jest.fn().mockResolvedValue(true),
    getTools: jest.fn().mockResolvedValue([]),
    addComment: jest.fn().mockResolvedValue(undefined),
    updateStatus: jest.fn().mockResolvedValue(undefined),
    getPromptContext: jest.fn().mockReturnValue('Test context'),
    getLink: jest.fn().mockReturnValue('https://example.com/issue/1'),
    getRequiredSecrets: jest.fn().mockReturnValue([]),
    supports: jest.fn().mockReturnValue(true),
  };

  // Mock event
  const mockEvent: TriggerEvent = {
    triggerType: 'test',
    triggerId: 'test-123',
    projectId: 'test-project',
    title: 'Test Issue',
    description: 'Test description',
    metadata: { issueNumber: 1 },
    raw: {},
  };

  // Mock project
  const mockProject: ProjectConfig = {
    id: 'test-project',
    name: 'Test Project',
    repo: 'https://github.com/test/repo.git',
    repoFullName: 'test/repo',
    branch: 'main',
    triggers: [],
    vcs: {
      type: 'github',
      owner: 'test',
      repo: 'repo',
    },
  };

  // Mock config
  const mockConfig: AiBugsConfig = {
    version: '2',
  };

  // Helper to create mock runner
  function createMockRunner(runResults: RunResult[]): RunnerPlugin {
    let callIndex = 0;
    return {
      id: 'test-runner',
      type: 'test',
      name: 'Test Runner',
      getRequiredSecrets: jest.fn().mockReturnValue([]),
      run: jest.fn().mockImplementation(() => {
        const result = runResults[callIndex] || runResults[runResults.length - 1];
        callIndex++;
        return Promise.resolve(result);
      }),
      isAvailable: jest.fn().mockResolvedValue(true),
      validate: jest.fn().mockResolvedValue({ valid: true }),
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Triage Step', () => {
    it('should run triage agent first', async () => {
      const triageResult: TriageResult = {
        actionable: true,
        trivial: true,
        complexity: 'simple',
        reasoning: 'Simple null check fix',
        suggestedAgent: 'simple',
      };

      const runner = createMockRunner([
        // Triage result
        {
          success: true,
          jobId: 'job-1',
          output: 'Triage complete',
          hasCommit: false,
          triageResult,
        },
        // Fix result
        {
          success: true,
          jobId: 'job-2',
          output: 'Fix complete',
          hasCommit: true,
          branchName: 'fix/test-123',
          analysis: {
            canAutoFix: true,
            confidence: 'high',
            summary: 'Fixed null check',
            rootCause: 'Missing null check',
            filesInvolved: ['src/test.ts'],
            complexity: 'simple',
          },
        },
      ]);

      const result = await orchestrateWithTriage(
        mockTrigger,
        mockEvent,
        mockProject,
        runner,
        mockConfig,
        '/tmp/workspace'
      );

      expect(runner.run).toHaveBeenCalledTimes(2);
      expect(result.fixed).toBe(true);
    });

    it('should fall back to legacy flow when no triage result', async () => {
      const runner = createMockRunner([
        // Triage with no result
        {
          success: true,
          jobId: 'job-1',
          output: 'No triage output',
          hasCommit: false,
          // triageResult is undefined
        },
        // Legacy fix result
        {
          success: true,
          jobId: 'job-2',
          output: 'Legacy fix',
          hasCommit: true,
          branchName: 'fix/test-123',
          analysis: {
            canAutoFix: true,
            confidence: 'high',
            summary: 'Fixed issue',
            rootCause: 'Bug',
            filesInvolved: ['src/test.ts'],
            complexity: 'simple',
          },
        },
      ]);

      const result = await orchestrateWithTriage(
        mockTrigger,
        mockEvent,
        mockProject,
        runner,
        mockConfig,
        '/tmp/workspace'
      );

      // Should still succeed via legacy flow
      expect(result.fixed).toBe(true);
    });
  });

  describe('Non-Actionable Issues', () => {
    it('should handle needs-info and post comment', async () => {
      const triageResult: TriageResult = {
        actionable: false,
        reason: 'needs-info',
        reasoning: 'Issue lacks reproduction steps',
        comment: 'Please provide steps to reproduce this issue.',
      };

      const runner = createMockRunner([
        {
          success: true,
          jobId: 'job-1',
          output: 'Triage complete',
          hasCommit: false,
          triageResult,
        },
      ]);

      const result = await orchestrateWithTriage(
        mockTrigger,
        mockEvent,
        mockProject,
        runner,
        mockConfig,
        '/tmp/workspace'
      );

      expect(result.fixed).toBe(false);
      expect(result.reason).toBe('needs-info');
      expect(mockTrigger.addComment).toHaveBeenCalledWith(
        mockEvent,
        'Please provide steps to reproduce this issue.'
      );
      // Should only run triage, not fix
      expect(runner.run).toHaveBeenCalledTimes(1);
    });

    it('should handle duplicate issues', async () => {
      const triageResult: TriageResult = {
        actionable: false,
        reason: 'duplicate',
        reasoning: 'This is a duplicate of #42',
      };

      const runner = createMockRunner([
        {
          success: true,
          jobId: 'job-1',
          output: 'Triage complete',
          hasCommit: false,
          triageResult,
        },
      ]);

      const result = await orchestrateWithTriage(
        mockTrigger,
        mockEvent,
        mockProject,
        runner,
        mockConfig,
        '/tmp/workspace'
      );

      expect(result.fixed).toBe(false);
      expect(result.reason).toBe('duplicate');
      expect(mockTrigger.addComment).toHaveBeenCalled();
    });

    it('should handle out-of-scope issues', async () => {
      const triageResult: TriageResult = {
        actionable: false,
        reason: 'out-of-scope',
        reasoning: 'Requires architectural changes',
      };

      const runner = createMockRunner([
        {
          success: true,
          jobId: 'job-1',
          output: 'Triage complete',
          hasCommit: false,
          triageResult,
        },
      ]);

      const result = await orchestrateWithTriage(
        mockTrigger,
        mockEvent,
        mockProject,
        runner,
        mockConfig,
        '/tmp/workspace'
      );

      expect(result.fixed).toBe(false);
      expect(result.reason).toBe('out-of-scope');
    });

    it('should handle wont-fix issues', async () => {
      const triageResult: TriageResult = {
        actionable: false,
        reason: 'wont-fix',
        reasoning: 'This is intended behavior',
      };

      const runner = createMockRunner([
        {
          success: true,
          jobId: 'job-1',
          output: 'Triage complete',
          hasCommit: false,
          triageResult,
        },
      ]);

      const result = await orchestrateWithTriage(
        mockTrigger,
        mockEvent,
        mockProject,
        runner,
        mockConfig,
        '/tmp/workspace'
      );

      expect(result.fixed).toBe(false);
      expect(result.reason).toBe('wont-fix');
    });
  });

  describe('Trivial Issues (Skip Investigation)', () => {
    it('should skip investigation for trivial issues', async () => {
      const triageResult: TriageResult = {
        actionable: true,
        trivial: true,
        complexity: 'simple',
        reasoning: 'Obvious null pointer fix',
        suggestedAgent: 'simple',
      };

      const runner = createMockRunner([
        // Triage
        {
          success: true,
          jobId: 'job-1',
          output: 'Triage complete',
          hasCommit: false,
          triageResult,
        },
        // Fix (no investigation step)
        {
          success: true,
          jobId: 'job-2',
          output: 'Fix complete',
          hasCommit: true,
          branchName: 'fix/test-123',
          analysis: {
            canAutoFix: true,
            confidence: 'high',
            summary: 'Added null check',
            rootCause: 'Missing null check',
            filesInvolved: ['src/test.ts'],
            complexity: 'trivial',
          },
        },
      ]);

      const result = await orchestrateWithTriage(
        mockTrigger,
        mockEvent,
        mockProject,
        runner,
        mockConfig,
        '/tmp/workspace'
      );

      // Should only call triage + fix (2 calls), not investigate
      expect(runner.run).toHaveBeenCalledTimes(2);
      expect(result.fixed).toBe(true);
    });
  });

  describe('Non-Trivial Issues (With Investigation)', () => {
    it('should run investigation before fix for non-trivial issues', async () => {
      const triageResult: TriageResult = {
        actionable: true,
        trivial: false,
        complexity: 'simple',
        reasoning: 'Needs investigation to understand data flow',
        suggestedAgent: 'simple',
      };

      const investigationResult: InvestigationContext = {
        rootCause: 'Race condition in auth flow',
        filesInvolved: ['src/auth.ts', 'src/session.ts'],
        suggestedApproach: 'Add mutex lock',
        summary: 'Concurrent requests cause session conflicts',
      };

      const runner = createMockRunner([
        // Triage
        {
          success: true,
          jobId: 'job-1',
          output: 'Triage complete',
          hasCommit: false,
          triageResult,
        },
        // Investigation
        {
          success: true,
          jobId: 'job-2',
          output: 'Investigation complete',
          hasCommit: false,
          investigationResult,
        },
        // Fix
        {
          success: true,
          jobId: 'job-3',
          output: 'Fix complete',
          hasCommit: true,
          branchName: 'fix/test-123',
          analysis: {
            canAutoFix: true,
            confidence: 'high',
            summary: 'Added mutex lock',
            rootCause: 'Race condition',
            filesInvolved: ['src/auth.ts', 'src/session.ts'],
            complexity: 'simple',
          },
        },
      ]);

      const result = await orchestrateWithTriage(
        mockTrigger,
        mockEvent,
        mockProject,
        runner,
        mockConfig,
        '/tmp/workspace'
      );

      // Should call triage + investigate + fix (3 calls)
      expect(runner.run).toHaveBeenCalledTimes(3);
      expect(result.fixed).toBe(true);
    });

    it('should route to complex agent for complex issues', async () => {
      const triageResult: TriageResult = {
        actionable: true,
        trivial: false,
        complexity: 'complex',
        reasoning: 'Requires architectural changes',
        suggestedAgent: 'complex',
      };

      const runner = createMockRunner([
        // Triage
        {
          success: true,
          jobId: 'job-1',
          output: 'Triage complete',
          hasCommit: false,
          triageResult,
        },
        // Investigation
        {
          success: true,
          jobId: 'job-2',
          output: 'Investigation complete',
          hasCommit: false,
          investigationResult: {
            rootCause: 'Complex issue',
            filesInvolved: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
            suggestedApproach: 'Refactor module',
          },
        },
        // Fix with complex agent
        {
          success: true,
          jobId: 'job-3',
          output: 'Fix complete',
          hasCommit: true,
          branchName: 'fix/test-123',
          analysis: {
            canAutoFix: true,
            confidence: 'high',
            summary: 'Refactored module',
            rootCause: 'Tight coupling',
            filesInvolved: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
            complexity: 'complex',
          },
        },
      ]);

      await orchestrateWithTriage(
        mockTrigger,
        mockEvent,
        mockProject,
        runner,
        mockConfig,
        '/tmp/workspace'
      );

      // Verify all three stages ran
      expect(runner.run).toHaveBeenCalledTimes(3);
    });
  });

  describe('Error Handling', () => {
    it('should handle triage failure', async () => {
      const runner = createMockRunner([
        {
          success: false,
          jobId: 'job-1',
          output: 'Triage failed',
          hasCommit: false,
          error: 'Timeout',
        },
      ]);

      const result = await orchestrateWithTriage(
        mockTrigger,
        mockEvent,
        mockProject,
        runner,
        mockConfig,
        '/tmp/workspace'
      );

      expect(result.fixed).toBe(false);
      expect(result.reason).toBe('triage_failed');
      expect(mockTrigger.addComment).toHaveBeenCalledWith(
        mockEvent,
        expect.stringContaining('Triage failed')
      );
    });

    it('should handle investigation failure', async () => {
      const runner = createMockRunner([
        // Triage succeeds
        {
          success: true,
          jobId: 'job-1',
          output: 'Triage complete',
          hasCommit: false,
          triageResult: {
            actionable: true,
            trivial: false,
            complexity: 'simple',
            reasoning: 'Needs investigation',
            suggestedAgent: 'simple',
          },
        },
        // Investigation fails
        {
          success: false,
          jobId: 'job-2',
          output: 'Investigation failed',
          hasCommit: false,
          error: 'Could not analyze codebase',
        },
      ]);

      const result = await orchestrateWithTriage(
        mockTrigger,
        mockEvent,
        mockProject,
        runner,
        mockConfig,
        '/tmp/workspace'
      );

      expect(result.fixed).toBe(false);
      expect(result.reason).toBe('investigation_failed');
    });

    it('should handle fix agent failure', async () => {
      const runner = createMockRunner([
        // Triage
        {
          success: true,
          jobId: 'job-1',
          output: 'Triage complete',
          hasCommit: false,
          triageResult: {
            actionable: true,
            trivial: true,
            complexity: 'simple',
            reasoning: 'Simple fix',
            suggestedAgent: 'simple',
          },
        },
        // Fix fails
        {
          success: false,
          jobId: 'job-2',
          output: 'Fix failed',
          hasCommit: false,
          error: 'Tests failed',
        },
      ]);

      const result = await orchestrateWithTriage(
        mockTrigger,
        mockEvent,
        mockProject,
        runner,
        mockConfig,
        '/tmp/workspace'
      );

      expect(result.fixed).toBe(false);
      expect(result.reason).toBe('fix_agent_failed');
    });
  });
});
