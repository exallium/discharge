import { TriggerEvent } from '../triggers/base';

/**
 * Job data structure for queued fix jobs
 */
export interface FixJobData {
  event: TriggerEvent;
  triggerType: string;
  queuedAt: string;
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
