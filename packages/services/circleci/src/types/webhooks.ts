/**
 * CircleCI webhook payload types
 * Based on CircleCI Webhook Events documentation
 */

/**
 * CircleCI VCS Info
 */
export interface CircleCIVCS {
  branch?: string;
  revision?: string;
  origin_repository_url?: string;
  target_repository_url?: string;
  provider_name?: string;
  org_name?: string;
  commit?: {
    subject?: string;
    body?: string;
    author?: {
      name?: string;
      email?: string;
    };
  };
}

/**
 * CircleCI Pipeline
 */
export interface CircleCIPipeline {
  id: string;
  number?: number;
  created_at?: string;
  project_slug?: string;
  trigger?: {
    type?: string;
  };
  vcs?: CircleCIVCS;
}

/**
 * CircleCI Workflow
 */
export interface CircleCIWorkflow {
  id: string;
  name: string;
  status: 'success' | 'failed' | 'error' | 'canceled' | 'unauthorized' | 'running' | 'not_run' | 'infrastructure_fail' | 'timedout' | 'on_hold';
  created_at?: string;
  stopped_at?: string;
  url?: string;
}

/**
 * CircleCI Job
 */
export interface CircleCIJob {
  id: string;
  name: string;
  status: 'success' | 'failed' | 'error' | 'canceled' | 'unauthorized' | 'running' | 'not_run' | 'infrastructure_fail' | 'timedout';
  number?: number;
  started_at?: string;
  stopped_at?: string;
}

/**
 * CircleCI Project
 */
export interface CircleCIProject {
  id?: string;
  name?: string;
  slug?: string;
}

/**
 * CircleCI Webhook Payload
 */
export interface CircleCIWebhookPayload {
  type: 'workflow-completed' | 'job-completed';
  id: string;
  happened_at?: string;
  webhook?: {
    id?: string;
    name?: string;
  };
  pipeline?: CircleCIPipeline;
  workflow?: CircleCIWorkflow;
  job?: CircleCIJob;
  project?: CircleCIProject;
  organization?: {
    id?: string;
    name?: string;
  };
}

/**
 * Type guard for workflow event
 */
export function isWorkflowEvent(payload: CircleCIWebhookPayload): boolean {
  return payload.type === 'workflow-completed' && !!payload.workflow;
}

/**
 * Type guard for job event
 */
export function isJobEvent(payload: CircleCIWebhookPayload): boolean {
  return payload.type === 'job-completed' && !!payload.job;
}

/**
 * Type guard for failed workflow
 */
export function isFailedWorkflow(payload: CircleCIWebhookPayload): boolean {
  return isWorkflowEvent(payload) && payload.workflow?.status === 'failed';
}

/**
 * Type guard for failed job
 */
export function isFailedJob(payload: CircleCIWebhookPayload): boolean {
  return isJobEvent(payload) && payload.job?.status === 'failed';
}
