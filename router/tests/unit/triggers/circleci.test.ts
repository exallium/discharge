import { CircleCITrigger } from '../../../src/triggers/circleci';
import { createMockWebhookRequest } from '../../mocks/webhook-request';
import * as projectsModule from '../../../src/config/projects';

// Mock projects module
jest.mock('../../../src/config/projects', () => ({
  findProjectsBySource: jest.fn(),
}));

describe('CircleCITrigger', () => {
  let trigger: CircleCITrigger;
  const mockFindProjectsBySource = projectsModule.findProjectsBySource as jest.MockedFunction<
    typeof projectsModule.findProjectsBySource
  >;

  // Mock project configuration
  const mockProject = {
    id: 'test-project',
    repo: 'git@github.com:owner/repo.git',
    repoFullName: 'owner/repo',
    branch: 'main',
    vcs: { type: 'github' as const, owner: 'owner', repo: 'repo' },
    triggers: {
      circleci: {
        enabled: true,
        projectSlug: 'gh/owner/repo',
      },
    },
  };

  beforeEach(() => {
    trigger = new CircleCITrigger();
    mockFindProjectsBySource.mockResolvedValue([mockProject]);
    delete process.env.CIRCLECI_WEBHOOK_SECRET;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should set id and type', () => {
      expect(trigger.id).toBe('circleci');
      expect(trigger.type).toBe('circleci');
    });
  });

  describe('validateWebhook', () => {
    it('should accept webhook without signature if no secret configured', async () => {
      const mockReq = createMockWebhookRequest({}, {});

      const result = await trigger.validateWebhook(mockReq);
      expect(result).toBe(true);
    });

    it('should validate correct CircleCI signature', async () => {
      process.env.CIRCLECI_WEBHOOK_SECRET = 'test-secret';

      const body = { test: 'payload' };
      const crypto = require('crypto');
      const signature = crypto
        .createHmac('sha256', 'test-secret')
        .update(JSON.stringify(body))
        .digest('hex');

      const mockReq = createMockWebhookRequest(
        { 'circleci-signature': `v1=${signature}` },
        body
      );

      const result = await trigger.validateWebhook(mockReq);
      expect(result).toBe(true);
    });

    it('should reject invalid CircleCI signature', async () => {
      process.env.CIRCLECI_WEBHOOK_SECRET = 'test-secret';

      const mockReq = createMockWebhookRequest(
        { 'circleci-signature': 'v1=invalid-signature' },
        { test: 'payload' }
      );

      const result = await trigger.validateWebhook(mockReq);
      expect(result).toBe(false);
    });

    it('should reject signature with wrong version', async () => {
      process.env.CIRCLECI_WEBHOOK_SECRET = 'test-secret';

      const mockReq = createMockWebhookRequest(
        { 'circleci-signature': 'v2=somehash' },
        { test: 'payload' }
      );

      const result = await trigger.validateWebhook(mockReq);
      expect(result).toBe(false);
    });

    it('should reject webhook if signature provided but no secret configured', async () => {
      const mockReq = createMockWebhookRequest(
        { 'circleci-signature': 'v1=somehash' },
        { test: 'payload' }
      );

      const result = await trigger.validateWebhook(mockReq);
      expect(result).toBe(false);
    });
  });

  describe('parseWebhook - workflow-completed', () => {
    const failedWorkflowPayload = {
      type: 'workflow-completed',
      id: 'webhook-id-123',
      happened_at: '2024-01-15T10:30:00Z',
      workflow: {
        id: 'workflow-123',
        name: 'build-and-test',
        status: 'failed',
        created_at: '2024-01-15T10:00:00Z',
        stopped_at: '2024-01-15T10:30:00Z',
        url: 'https://app.circleci.com/pipelines/github/owner/repo/123/workflows/workflow-123',
      },
      pipeline: {
        id: 'pipeline-123',
        number: 456,
        project_slug: 'gh/owner/repo',
        vcs: {
          provider_name: 'github',
          org_name: 'owner',
          repo_name: 'repo',
          branch: 'feature/new-feature',
          revision: 'abc123def456',
          commit: {
            subject: 'Add new feature',
            author: {
              name: 'John Doe',
              email: 'john@example.com',
            },
          },
        },
      },
    };

    it('should parse failed workflow webhook', async () => {
      const event = await trigger.parseWebhook(failedWorkflowPayload);

      expect(event).not.toBeNull();
      expect(event?.triggerType).toBe('circleci');
      expect(event?.triggerId).toBe('workflow-123');
      expect(event?.projectId).toBe('test-project');
      expect(event?.title).toBe('Failed workflow: build-and-test');
      expect(event?.description).toContain('feature/new-feature');
      expect(event?.metadata.severity).toBe('high');
      expect(event?.metadata.workflowName).toBe('build-and-test');
      expect(event?.metadata.branch).toBe('feature/new-feature');
      expect(event?.metadata.commitMessage).toBe('Add new feature');
      expect(event?.metadata.commitAuthor).toBe('John Doe');
      expect(event?.links?.web).toContain('circleci.com');
    });

    it('should ignore non-failed workflow', async () => {
      const successPayload = {
        ...failedWorkflowPayload,
        workflow: {
          ...failedWorkflowPayload.workflow,
          status: 'success',
        },
      };

      const event = await trigger.parseWebhook(successPayload);
      expect(event).toBeNull();
    });

    it('should return null if no workflow data', async () => {
      const invalidPayload = {
        type: 'workflow-completed',
        id: 'webhook-id-123',
      };

      const event = await trigger.parseWebhook(invalidPayload);
      expect(event).toBeNull();
    });

    it('should return null if project not found', async () => {
      mockFindProjectsBySource.mockResolvedValue([]);

      const event = await trigger.parseWebhook(failedWorkflowPayload);
      expect(event).toBeNull();
    });
  });

  describe('parseWebhook - job-completed', () => {
    const failedJobPayload = {
      type: 'job-completed',
      id: 'webhook-id-456',
      happened_at: '2024-01-15T10:30:00Z',
      job: {
        id: 'job-456',
        name: 'test',
        number: 789,
        status: 'failed',
        started_at: '2024-01-15T10:20:00Z',
        stopped_at: '2024-01-15T10:30:00Z',
      },
      workflow: {
        id: 'workflow-456',
        name: 'build-and-test',
      },
      pipeline: {
        id: 'pipeline-456',
        number: 789,
        project_slug: 'gh/owner/repo',
        vcs: {
          provider_name: 'github',
          org_name: 'owner',
          repo_name: 'repo',
          branch: 'main',
          revision: 'def789abc123',
          commit: {
            subject: 'Fix bug',
            author: {
              name: 'Jane Smith',
            },
          },
        },
      },
    };

    it('should parse failed job webhook', async () => {
      const event = await trigger.parseWebhook(failedJobPayload);

      expect(event).not.toBeNull();
      expect(event?.triggerType).toBe('circleci');
      expect(event?.triggerId).toBe('job-456');
      expect(event?.projectId).toBe('test-project');
      expect(event?.title).toBe('Failed job: test');
      expect(event?.description).toContain('build-and-test');
      expect(event?.metadata.severity).toBe('high');
      expect(event?.metadata.jobName).toBe('test');
      expect(event?.metadata.jobNumber).toBe(789);
      expect(event?.metadata.workflowName).toBe('build-and-test');
      expect(event?.metadata.branch).toBe('main');
      expect(event?.links?.web).toContain('circleci.com');
    });

    it('should ignore non-failed job', async () => {
      const successPayload = {
        ...failedJobPayload,
        job: {
          ...failedJobPayload.job,
          status: 'success',
        },
      };

      const event = await trigger.parseWebhook(successPayload);
      expect(event).toBeNull();
    });

    it('should return null if no job data', async () => {
      const invalidPayload = {
        type: 'job-completed',
        id: 'webhook-id-456',
      };

      const event = await trigger.parseWebhook(invalidPayload);
      expect(event).toBeNull();
    });
  });

  describe('parseWebhook - other events', () => {
    it('should ignore unknown event types', async () => {
      const unknownPayload = {
        type: 'pipeline-started',
        id: 'webhook-id-789',
      };

      const event = await trigger.parseWebhook(unknownPayload);
      expect(event).toBeNull();
    });
  });

  describe('shouldProcess', () => {
    it('should process failed events', async () => {
      const event = {
        triggerType: 'circleci',
        triggerId: 'test-123',
        projectId: 'test-project',
        title: 'Failed workflow',
        description: 'Test',
        metadata: {
          status: 'failed',
        },
        raw: {},
      };

      const result = await trigger.shouldProcess(event);
      expect(result).toBe(true);
    });

    it('should not process non-failed events', async () => {
      const event = {
        triggerType: 'circleci',
        triggerId: 'test-123',
        projectId: 'test-project',
        title: 'Success workflow',
        description: 'Test',
        metadata: {
          status: 'success',
        },
        raw: {},
      };

      const result = await trigger.shouldProcess(event);
      expect(result).toBe(false);
    });
  });

  describe('getTools', () => {
    it('should generate tools for workflow event', async () => {
      const event = {
        triggerType: 'circleci',
        triggerId: 'workflow-123',
        projectId: 'test-project',
        title: 'Failed workflow',
        description: 'Test',
        metadata: {
          workflowId: 'workflow-123',
          pipelineNumber: 456,
        },
        raw: {},
      };

      const tools = await trigger.getTools(event);

      expect(tools.length).toBeGreaterThan(0);
      expect(tools.some((t) => t.name === 'get-workflow')).toBe(true);
      expect(tools.some((t) => t.name === 'get-workflow-jobs')).toBe(true);
      expect(tools.some((t) => t.name === 'get-pipeline')).toBe(true);

      // Check tool scripts contain API calls
      const workflowTool = tools.find((t) => t.name === 'get-workflow');
      expect(workflowTool?.script).toContain('circleci.com/api/v2/workflow');
      expect(workflowTool?.script).toContain('CIRCLECI_TOKEN');
    });

    it('should generate tools for job event', async () => {
      const event = {
        triggerType: 'circleci',
        triggerId: 'job-456',
        projectId: 'test-project',
        title: 'Failed job',
        description: 'Test',
        metadata: {
          jobId: 'job-456',
          jobNumber: 789,
          workflowId: 'workflow-456',
        },
        raw: {},
      };

      const tools = await trigger.getTools(event);

      expect(tools.length).toBeGreaterThan(0);
      expect(tools.some((t) => t.name === 'get-job-details')).toBe(true);
      expect(tools.some((t) => t.name === 'get-test-results')).toBe(true);
    });
  });

  describe('getPromptContext', () => {
    it('should format context for workflow event', () => {
      const event = {
        triggerType: 'circleci',
        triggerId: 'workflow-123',
        projectId: 'test-project',
        title: 'Failed workflow: build-and-test',
        description: 'Workflow failed on branch feature/new-feature',
        metadata: {
          workflowName: 'build-and-test',
          status: 'failed',
          branch: 'feature/new-feature',
          commitMessage: 'Add new feature',
          commitAuthor: 'John Doe',
        },
        links: {
          web: 'https://app.circleci.com/...',
        },
        raw: {},
      };

      const context = trigger.getPromptContext(event);

      expect(context).toContain('Failed workflow: build-and-test');
      expect(context).toContain('build-and-test');
      expect(context).toContain('failed');
      expect(context).toContain('feature/new-feature');
      expect(context).toContain('Add new feature');
      expect(context).toContain('John Doe');
    });

    it('should format context for job event', () => {
      const event = {
        triggerType: 'circleci',
        triggerId: 'job-456',
        projectId: 'test-project',
        title: 'Failed job: test',
        description: 'Job failed',
        metadata: {
          jobName: 'test',
          status: 'failed',
          branch: 'main',
        },
        links: {
          web: 'https://app.circleci.com/...',
        },
        raw: {},
      };

      const context = trigger.getPromptContext(event);

      expect(context).toContain('Failed job: test');
      expect(context).toContain('test');
      expect(context).toContain('main');
    });
  });

  describe('getLink', () => {
    it('should format link for workflow', () => {
      const event = {
        triggerType: 'circleci',
        triggerId: 'workflow-123',
        projectId: 'test-project',
        title: 'Failed workflow',
        description: 'Test',
        metadata: {
          workflowName: 'build-and-test',
        },
        links: {
          web: 'https://app.circleci.com/...',
        },
        raw: {},
      };

      const link = trigger.getLink(event);

      expect(link).toBe('[CircleCI build-and-test](https://app.circleci.com/...)');
    });

    it('should format link for job', () => {
      const event = {
        triggerType: 'circleci',
        triggerId: 'job-456',
        projectId: 'test-project',
        title: 'Failed job',
        description: 'Test',
        metadata: {
          jobName: 'test',
        },
        links: {
          web: 'https://app.circleci.com/...',
        },
        raw: {},
      };

      const link = trigger.getLink(event);

      expect(link).toBe('[CircleCI test](https://app.circleci.com/...)');
    });
  });

  describe('updateStatus', () => {
    it('should log status update', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      const event = {
        triggerType: 'circleci',
        triggerId: 'workflow-123',
        projectId: 'test-project',
        title: 'Failed workflow',
        description: 'Test',
        metadata: {},
        raw: {},
      };

      await trigger.updateStatus(event, { fixed: true });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[CircleCITrigger] Status update for workflow-123: fixed')
      );

      consoleSpy.mockRestore();
    });
  });

  describe('addComment', () => {
    it('should log comment addition', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      const event = {
        triggerType: 'circleci',
        triggerId: 'workflow-123',
        projectId: 'test-project',
        title: 'Failed workflow',
        description: 'Test',
        metadata: {},
        raw: {},
      };

      await trigger.addComment(event, 'Test comment');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[CircleCITrigger] Would add comment to workflow-123')
      );

      consoleSpy.mockRestore();
    });
  });
});
