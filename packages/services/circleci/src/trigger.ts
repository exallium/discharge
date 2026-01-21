/**
 * CircleCI Trigger Plugin
 *
 * Handles CircleCI webhook events for failed workflows and jobs.
 *
 * Webhook setup:
 * 1. In CircleCI project settings, go to "Webhooks"
 * 2. Set webhook URL to: https://your-domain/webhooks/circleci
 * 3. Enable "workflow-completed" and "job-completed" events
 * 4. Add signing secret for verification
 *
 * Documentation: https://circleci.com/docs/webhooks/
 */

import crypto from 'crypto';
import {
  TriggerPlugin,
  TriggerEvent,
  Tool,
  FixStatus,
  WebhookRequest,
  WebhookConfig,
  SecretRequirement,
  TriggerProjectConfig,
  getSecretsProvider,
  getProjectProvider,
  getLogger,
} from '@ai-bug-fixer/service-sdk';
import {
  CircleCIWebhookPayload,
  isWorkflowEvent,
  isJobEvent,
  isFailedWorkflow,
  isFailedJob,
} from './types/webhooks';

/**
 * CircleCI trigger plugin
 */
export class CircleCITrigger implements TriggerPlugin {
  id = 'circleci';
  type = 'circleci';

  webhookConfig: WebhookConfig = {
    events: ['workflow-completed', 'job-completed'],
    docsUrl: 'https://circleci.com/docs/webhooks/',
  };

  /**
   * Get header value from WebhookRequest
   */
  private getHeader(req: WebhookRequest, name: string): string | null {
    return req.headers.get(name);
  }

  /**
   * Validate CircleCI webhook signature
   * https://circleci.com/docs/webhooks/#validate-webhooks
   */
  async validateWebhook(req: WebhookRequest): Promise<boolean> {
    const signature = this.getHeader(req, 'circleci-signature');
    const logger = getLogger();

    // If no signature provided and no secret configured, accept it
    if (!signature) {
      logger.warn('[CircleCITrigger] No signature provided - accepting webhook (not recommended for production)');
      return true;
    }

    // Verify signature if provided
    const secrets = getSecretsProvider();
    const secret = await secrets.getSecret('circleci', 'webhook_secret');
    if (!secret) {
      logger.warn('[CircleCITrigger] Signature provided but webhook secret not configured - rejecting webhook');
      return false;
    }

    // CircleCI signature format: v1=<signature>
    const signatureVersion = signature.split('=')[0];
    const signatureHash = signature.split('=')[1];

    if (signatureVersion !== 'v1') {
      logger.warn(`[CircleCITrigger] Unsupported signature version: ${signatureVersion}`);
      return false;
    }

    // Use raw body for signature verification (JSON.stringify may produce different output)
    const body = req.rawBody ?? JSON.stringify(req.body);
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(body)
      .digest('hex');

    return signatureHash === expectedSignature;
  }

  /**
   * Parse CircleCI webhook payload into normalized TriggerEvent
   */
  async parseWebhook(payload: unknown): Promise<TriggerEvent | null> {
    const typedPayload = payload as CircleCIWebhookPayload;
    const logger = getLogger();

    // We handle both workflow-completed and job-completed events
    if (isWorkflowEvent(typedPayload)) {
      return this.parseWorkflowEvent(typedPayload);
    } else if (isJobEvent(typedPayload)) {
      return this.parseJobEvent(typedPayload);
    } else {
      logger.info(`[CircleCITrigger] Ignoring event type: ${typedPayload.type}`);
      return null;
    }
  }

  /**
   * Parse workflow-completed event
   */
  private async parseWorkflowEvent(payload: CircleCIWebhookPayload): Promise<TriggerEvent | null> {
    const workflow = payload.workflow;
    const logger = getLogger();

    if (!workflow) {
      logger.error('[CircleCITrigger] No workflow data in payload');
      return null;
    }

    // Only trigger on failed workflows
    if (!isFailedWorkflow(payload)) {
      logger.info(`[CircleCITrigger] Ignoring workflow status: ${workflow.status}`);
      return null;
    }

    // Find project by CircleCI project slug or VCS URL
    const project = await this.findProjectFromPayload(payload);
    if (!project) {
      return null;
    }

    const pipeline = payload.pipeline;
    const vcs = pipeline?.vcs;

    // Build title and description
    const title = `Failed workflow: ${workflow.name}`;
    const description = `Workflow failed on branch ${vcs?.branch || 'unknown'}`;

    // Map CircleCI status to severity
    const severity = 'high'; // Failed workflows are always high priority

    return {
      triggerType: 'circleci',
      triggerId: workflow.id,
      projectId: project.id,
      title,
      description,
      metadata: {
        severity,
        workflowName: workflow.name,
        workflowId: workflow.id,
        status: workflow.status,
        branch: vcs?.branch,
        revision: vcs?.revision,
        commitMessage: vcs?.commit?.subject,
        commitAuthor: vcs?.commit?.author?.name,
        pipelineNumber: pipeline?.number,
        createdAt: workflow.created_at,
        stoppedAt: workflow.stopped_at,
      },
      links: {
        web: workflow.url,
      },
      raw: payload,
    };
  }

  /**
   * Parse job-completed event
   */
  private async parseJobEvent(payload: CircleCIWebhookPayload): Promise<TriggerEvent | null> {
    const job = payload.job;
    const logger = getLogger();

    if (!job) {
      logger.error('[CircleCITrigger] No job data in payload');
      return null;
    }

    // Only trigger on failed jobs
    if (!isFailedJob(payload)) {
      logger.info(`[CircleCITrigger] Ignoring job status: ${job.status}`);
      return null;
    }

    // Find project
    const project = await this.findProjectFromPayload(payload);
    if (!project) {
      return null;
    }

    const pipeline = payload.pipeline;
    const vcs = pipeline?.vcs;

    // Build title and description
    const title = `Failed job: ${job.name}`;
    const description = `Job failed in workflow ${payload.workflow?.name || 'unknown'}`;

    return {
      triggerType: 'circleci',
      triggerId: job.id,
      projectId: project.id,
      title,
      description,
      metadata: {
        severity: 'high',
        jobName: job.name,
        jobId: job.id,
        jobNumber: job.number,
        status: job.status,
        workflowName: payload.workflow?.name,
        workflowId: payload.workflow?.id,
        branch: vcs?.branch,
        revision: vcs?.revision,
        commitMessage: vcs?.commit?.subject,
        commitAuthor: vcs?.commit?.author?.name,
        startedAt: job.started_at,
        stoppedAt: job.stopped_at,
      },
      links: {
        web: `https://app.circleci.com/pipelines/${pipeline?.vcs?.provider_name}/${pipeline?.vcs?.org_name}/${pipeline?.project_slug}/${pipeline?.number}/workflows/${payload.workflow?.id}/jobs/${job.number}`,
      },
      raw: payload,
    };
  }

  /**
   * Find project from CircleCI payload
   */
  private async findProjectFromPayload(payload: CircleCIWebhookPayload): Promise<TriggerProjectConfig | null> {
    // Project slug can be in pipeline.project_slug or project.slug
    const projectSlug = payload.pipeline?.project_slug || payload.project?.slug;
    const logger = getLogger();
    const projects = getProjectProvider();

    if (!projectSlug) {
      logger.error('[CircleCITrigger] No project slug in payload');
      return null;
    }

    const matchingProjects = await projects.findBySource<{ enabled?: boolean; projectSlug?: string }>('circleci', (config) => {
      return !!config.enabled && config.projectSlug === projectSlug;
    });

    if (matchingProjects.length === 0) {
      logger.error(`[CircleCITrigger] No project configured for CircleCI slug: ${projectSlug}`);
      return null;
    }

    if (matchingProjects.length > 1) {
      logger.warn(`[CircleCITrigger] Multiple projects found for CircleCI slug ${projectSlug}, using first one`);
    }

    return matchingProjects[0];
  }

  /**
   * Check if event should be processed
   */
  async shouldProcess(event: TriggerEvent): Promise<boolean> {
    // Only process failed workflows/jobs
    const status = event.metadata.status as string;
    return status === 'failed';
  }

  /**
   * Generate investigation tools for CircleCI issues
   */
  async getTools(event: TriggerEvent): Promise<Tool[]> {
    const tools: Tool[] = [];

    const workflowId = event.metadata.workflowId as string;
    const jobNumber = event.metadata.jobNumber as number;
    const pipelineNumber = event.metadata.pipelineNumber as number;

    // Tool: Get workflow details
    if (workflowId) {
      tools.push({
        name: 'get-workflow',
        description: 'Get CircleCI workflow details including all jobs (JSON)',
        script: `#!/bin/bash
set -e
curl -s "https://circleci.com/api/v2/workflow/${workflowId}" \\
  -H "Circle-Token: \${CIRCLECI_TOKEN}" \\
  | jq '{
    id: .id,
    name: .name,
    status: .status,
    created_at: .created_at,
    stopped_at: .stopped_at,
    pipeline_id: .pipeline_id,
    pipeline_number: .pipeline_number
  }'
`,
      });
    }

    // Tool: Get workflow jobs
    if (workflowId) {
      tools.push({
        name: 'get-workflow-jobs',
        description: 'Get all jobs in the workflow with their statuses (JSON)',
        script: `#!/bin/bash
set -e
curl -s "https://circleci.com/api/v2/workflow/${workflowId}/job" \\
  -H "Circle-Token: \${CIRCLECI_TOKEN}" \\
  | jq '.items[] | {
    id: .id,
    job_number: .job_number,
    name: .name,
    status: .status,
    type: .type,
    started_at: .started_at,
    stopped_at: .stopped_at
  }'
`,
      });
    }

    // Tool: Get job details and test results
    if (jobNumber) {
      tools.push({
        name: 'get-job-details',
        description: 'Get detailed job information including steps and test results (JSON)',
        script: `#!/bin/bash
set -e
curl -s "https://circleci.com/api/v2/project/gh/\${CIRCLE_PROJECT_USERNAME}/\${CIRCLE_PROJECT_REPONAME}/job/${jobNumber}" \\
  -H "Circle-Token: \${CIRCLECI_TOKEN}" \\
  | jq '{
    id: .id,
    job_number: .job_number,
    name: .name,
    status: .status,
    started_at: .started_at,
    stopped_at: .stopped_at,
    duration: .duration,
    executor: .executor,
    steps: [.messages[] | {
      type: .type,
      message: .message,
      allocation_id: .allocation_id
    }]
  }'
`,
      });
    }

    // Tool: Get test results
    if (jobNumber) {
      tools.push({
        name: 'get-test-results',
        description: 'Get test results for the failed job (JSON)',
        script: `#!/bin/bash
set -e
curl -s "https://circleci.com/api/v2/project/gh/\${CIRCLE_PROJECT_USERNAME}/\${CIRCLE_PROJECT_REPONAME}/${jobNumber}/tests" \\
  -H "Circle-Token: \${CIRCLECI_TOKEN}" \\
  | jq '.items[] | select(.result == "failure") | {
    classname: .classname,
    name: .name,
    result: .result,
    message: .message,
    file: .file,
    source: .source
  }'
`,
      });
    }

    // Tool: Get pipeline details
    if (pipelineNumber) {
      tools.push({
        name: 'get-pipeline',
        description: 'Get pipeline information (JSON)',
        script: `#!/bin/bash
set -e
# Note: Replace with actual project path
curl -s "https://circleci.com/api/v2/pipeline/${event.metadata.pipelineId || event.triggerId}" \\
  -H "Circle-Token: \${CIRCLECI_TOKEN}" \\
  | jq '{
    id: .id,
    number: .number,
    state: .state,
    created_at: .created_at,
    vcs: .vcs,
    trigger: .trigger
  }'
`,
      });
    }

    return tools;
  }

  /**
   * Get prompt context for CircleCI issues
   */
  getPromptContext(event: TriggerEvent): string {
    const metadata = event.metadata;

    let context = `**Title:** ${event.title}\n\n`;

    if (metadata.workflowName) {
      context += `**Workflow:** ${metadata.workflowName}\n`;
    }

    if (metadata.jobName) {
      context += `**Job:** ${metadata.jobName}\n`;
    }

    context += `**Status:** ${metadata.status}\n`;

    if (metadata.branch) {
      context += `**Branch:** ${metadata.branch}\n`;
    }

    if (metadata.commitMessage) {
      context += `**Commit:** ${metadata.commitMessage}\n`;
    }

    if (metadata.commitAuthor) {
      context += `**Author:** ${metadata.commitAuthor}\n`;
    }

    context += `\n**Link:** ${event.links?.web}\n`;

    return context;
  }

  /**
   * Get link to CircleCI issue
   */
  getLink(event: TriggerEvent): string {
    return `[CircleCI ${event.metadata.workflowName || event.metadata.jobName || 'Workflow'}](${event.links?.web})`;
  }

  /**
   * Update CircleCI status (not directly supported, but we can add comments to commit)
   */
  async updateStatus(event: TriggerEvent, status: FixStatus): Promise<void> {
    const logger = getLogger();
    // CircleCI doesn't have a native way to update workflow/job status
    // Could potentially update commit status via GitHub/GitLab API
    logger.info(`[CircleCITrigger] Status update for ${event.triggerId}: ${status.fixed ? 'fixed' : 'not fixed'}`);
  }

  /**
   * Add comment to CircleCI (via VCS provider)
   */
  async addComment(event: TriggerEvent, comment: string): Promise<void> {
    const logger = getLogger();
    // CircleCI doesn't support comments directly
    // This would need to go through the VCS provider (GitHub, GitLab, etc.)
    logger.info(`[CircleCITrigger] Would add comment to ${event.triggerId}: ${comment.substring(0, 100)}...`);

    // In a real implementation, you would:
    // 1. Extract commit SHA from event.metadata.revision
    // 2. Use GitHub/GitLab API to add a commit comment
    // 3. Or add a PR comment if this is part of a PR
  }

  /**
   * Get the secrets required by this trigger
   */
  getRequiredSecrets(): SecretRequirement[] {
    return [
      {
        id: 'circleci_token',
        label: 'CircleCI Token',
        description: 'API token for CircleCI (used to fetch job details and test results)',
        required: true,
        plugin: 'circleci',
        key: 'token',
      },
      {
        id: 'circleci_webhook_secret',
        label: 'CircleCI Webhook Secret',
        description: 'Secret for validating CircleCI webhook signatures (optional but recommended)',
        required: false,
        plugin: 'circleci',
        key: 'webhook_secret',
      },
    ];
  }
}
