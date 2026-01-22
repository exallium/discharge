/**
 * Timeline Event Type Definitions
 *
 * These types define the structure of timeline events displayed in the UI.
 * Events are normalized from various sources (messages, jobs, labels, etc.)
 * into a consistent format for rendering.
 */

/**
 * All possible timeline event types
 */
export type TimelineEventType =
  | 'message'
  | 'job_started'
  | 'job_completed'
  | 'job_failed'
  | 'plan_created'
  | 'plan_updated'
  | 'plan_approved'
  | 'pr_created'
  | 'pr_merged'
  | 'labeled'
  | 'comment_posted';

/**
 * Message event payload
 */
export interface MessageEventData {
  role: 'user' | 'assistant' | 'system';
  content: string;
  sourceType?: string | null;
  sourceId?: string | null;
  sourceAuthor?: string | null;
}

/**
 * Job started event payload
 */
export interface JobStartedEventData {
  jobId: string;
}

/**
 * Job completed event payload
 */
export interface JobCompletedEventData {
  jobId: string;
  durationMs?: number;
  fixed: boolean;
  prUrl?: string | null;
  summary?: string;
}

/**
 * Job failed event payload
 */
export interface JobFailedEventData {
  jobId: string;
  durationMs?: number;
  error: string;
}

/**
 * Plan created event payload
 */
export interface PlanCreatedEventData {
  planRef: string;
  prNumber?: number;
  prUrl?: string;
  iteration: number;
  confidence?: number;
}

/**
 * Plan updated event payload
 */
export interface PlanUpdatedEventData {
  planRef: string;
  iteration: number;
  changesDescription?: string;
}

/**
 * Plan approved event payload
 */
export interface PlanApprovedEventData {
  planRef: string;
  approver?: string;
}

/**
 * PR created event payload
 */
export interface PRCreatedEventData {
  prNumber: number;
  prUrl: string;
  title: string;
  branchName: string;
}

/**
 * PR merged event payload
 */
export interface PRMergedEventData {
  prNumber: number;
  prUrl: string;
  mergedBy?: string;
}

/**
 * Label added event payload
 */
export interface LabeledEventData {
  label: string;
  addedBy?: string;
}

/**
 * Comment posted event payload
 */
export interface CommentPostedEventData {
  body: string;
  targetType: 'issue' | 'pr';
  targetNumber: number;
}

/**
 * Union of all event data types
 */
export type TimelineEventData =
  | { type: 'message'; data: MessageEventData }
  | { type: 'job_started'; data: JobStartedEventData }
  | { type: 'job_completed'; data: JobCompletedEventData }
  | { type: 'job_failed'; data: JobFailedEventData }
  | { type: 'plan_created'; data: PlanCreatedEventData }
  | { type: 'plan_updated'; data: PlanUpdatedEventData }
  | { type: 'plan_approved'; data: PlanApprovedEventData }
  | { type: 'pr_created'; data: PRCreatedEventData }
  | { type: 'pr_merged'; data: PRMergedEventData }
  | { type: 'labeled'; data: LabeledEventData }
  | { type: 'comment_posted'; data: CommentPostedEventData };

/**
 * A timeline event with common fields
 */
export interface TimelineEvent {
  id: string;
  timestamp: Date | string;
  type: TimelineEventType;
  data: TimelineEventData['data'];
}

/**
 * Type guard for message events
 */
export function isMessageEvent(
  event: TimelineEvent
): event is TimelineEvent & { type: 'message'; data: MessageEventData } {
  return event.type === 'message';
}

/**
 * Type guard for job events
 */
export function isJobEvent(
  event: TimelineEvent
): event is TimelineEvent & {
  type: 'job_started' | 'job_completed' | 'job_failed';
  data: JobStartedEventData | JobCompletedEventData | JobFailedEventData;
} {
  return (
    event.type === 'job_started' ||
    event.type === 'job_completed' ||
    event.type === 'job_failed'
  );
}

/**
 * Type guard for plan events
 */
export function isPlanEvent(
  event: TimelineEvent
): event is TimelineEvent & {
  type: 'plan_created' | 'plan_updated' | 'plan_approved';
  data: PlanCreatedEventData | PlanUpdatedEventData | PlanApprovedEventData;
} {
  return (
    event.type === 'plan_created' ||
    event.type === 'plan_updated' ||
    event.type === 'plan_approved'
  );
}

/**
 * Type guard for PR events
 */
export function isPREvent(
  event: TimelineEvent
): event is TimelineEvent & {
  type: 'pr_created' | 'pr_merged';
  data: PRCreatedEventData | PRMergedEventData;
} {
  return event.type === 'pr_created' || event.type === 'pr_merged';
}
