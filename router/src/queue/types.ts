import { TriggerEvent } from '../triggers/base';
import type { ConversationEvent, RouteMode } from '../types/conversation';

/**
 * Conversation job data for the queue
 */
export interface ConversationJobData {
  jobId: string;
  conversationId: string;
  projectId: string;
  triggerType: string;
  triggerId: string;
  events: ConversationEvent[];
  routeMode: RouteMode;
  iteration: number;
  isInitial: boolean;
  queuedAt: string;
}

/**
 * Job data structure for queued fix jobs
 */
export interface FixJobData {
  event: TriggerEvent;
  triggerType: string;
  queuedAt: string;
  /** Conversation-specific data (for conversation mode jobs) */
  conversationData?: ConversationJobData;
}

/**
 * Job options for BullMQ
 */
export interface FixJobOptions {
  attempts?: number;
  backoff?: {
    type: 'exponential' | 'fixed';
    delay: number;
  };
  priority?: number;
  removeOnComplete?: boolean | number;
  removeOnFail?: boolean | number;
}

/**
 * Job result after processing
 */
export interface FixJobResult {
  success: boolean;
  fixed: boolean;
  reason?: string;
  prUrl?: string;
  duration: number;
}
