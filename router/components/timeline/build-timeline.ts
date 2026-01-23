/**
 * Build Timeline Events
 *
 * Transforms raw message and job data into typed timeline entries.
 */

import type {
  TimelineEventType,
  MessageEventData,
  JobStartedEventData,
  JobCompletedEventData,
  JobFailedEventData,
} from '@discharge/service-sdk';

/**
 * Message data from the database
 */
export interface MessageData {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  sourceType?: string | null;
  sourceId?: string | null;
  sourceAuthor?: string | null;
  createdAt: Date;
}

/**
 * Job data from the database
 */
export interface JobData {
  id?: string;
  jobId: string;
  status: string;
  fixed?: boolean | null;
  error?: string | null;
  prUrl?: string | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
  createdAt: Date;
}

/**
 * A timeline entry with typed data
 */
export interface TimelineEntry {
  id: string;
  type: TimelineEventType;
  timestamp: Date;
  data: MessageEventData | JobStartedEventData | JobCompletedEventData | JobFailedEventData | Record<string, unknown>;
}

/**
 * Build a sorted timeline from messages and jobs
 */
export function buildTimelineEvents(
  messages: MessageData[],
  jobs: JobData[]
): TimelineEntry[] {
  const timeline: TimelineEntry[] = [];

  // Add messages
  for (const msg of messages) {
    timeline.push({
      id: `msg-${msg.id}`,
      type: 'message',
      timestamp: msg.createdAt,
      data: {
        role: msg.role,
        content: msg.content,
        sourceType: msg.sourceType,
        sourceId: msg.sourceId,
        sourceAuthor: msg.sourceAuthor,
      } as MessageEventData,
    });
  }

  // Add jobs with their start and completion events
  for (const job of jobs) {
    const startTime = job.startedAt ? new Date(job.startedAt) : new Date(job.createdAt);
    const endTime = job.completedAt ? new Date(job.completedAt) : undefined;
    const durationMs = endTime ? endTime.getTime() - startTime.getTime() : undefined;

    // Job started event (or pending if not started yet)
    if (job.status === 'pending' || job.status === 'running') {
      timeline.push({
        id: `job-start-${job.jobId}`,
        type: 'job_started',
        timestamp: startTime,
        data: {
          jobId: job.jobId,
        } as JobStartedEventData,
      });
    }

    // Job completed or failed event
    if (job.status === 'success' && endTime) {
      timeline.push({
        id: `job-complete-${job.jobId}`,
        type: 'job_completed',
        timestamp: endTime,
        data: {
          jobId: job.jobId,
          durationMs,
          fixed: job.fixed ?? false,
          prUrl: job.prUrl,
        } as JobCompletedEventData,
      });
    } else if (job.status === 'failed' && endTime) {
      timeline.push({
        id: `job-failed-${job.jobId}`,
        type: 'job_failed',
        timestamp: endTime,
        data: {
          jobId: job.jobId,
          durationMs,
          error: job.error || 'Unknown error',
        } as JobFailedEventData,
      });
    } else if (job.status !== 'pending' && job.status !== 'running') {
      // Handle other statuses (skipped, etc.) as completed
      timeline.push({
        id: `job-${job.jobId}`,
        type: 'job_completed',
        timestamp: endTime || startTime,
        data: {
          jobId: job.jobId,
          durationMs,
          fixed: job.fixed ?? false,
          prUrl: job.prUrl,
        } as JobCompletedEventData,
      });
    }
  }

  // Sort by timestamp
  timeline.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  return timeline;
}
