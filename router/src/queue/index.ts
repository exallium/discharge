import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { FixJobData, FixJobOptions } from './types';
import * as jobHistoryRepo from '../db/repositories/job-history';

/**
 * Lazy-initialized queue and connection
 * This allows tests to set REDIS_URL before initialization
 */
let connection: Redis | null = null;
let fixQueue: Queue<FixJobData> | null = null;

/**
 * Get Redis connection (creates if needed)
 */
export function getConnection(): Redis {
  if (!connection) {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    connection = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
  }
  return connection;
}

/**
 * Get the fix queue (creates if needed)
 */
function getQueue(): Queue<FixJobData> {
  if (!fixQueue) {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    fixQueue = new Queue<FixJobData>('claude-fix-jobs', {
      connection: {
        url: redisUrl,
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
      },
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: {
          count: 100, // Keep last 100 completed jobs
          age: 24 * 3600, // Keep for 24 hours
        },
        removeOnFail: {
          count: 50, // Keep last 50 failed jobs
          age: 7 * 24 * 3600, // Keep for 7 days
        },
      },
    });
  }
  return fixQueue;
}

/**
 * Initialize the queue
 */
export async function initializeQueue(): Promise<void> {
  const conn = getConnection();
  await conn.ping();

  const queue = getQueue();
  console.log('✓ Queue initialized', {
    redis: process.env.REDIS_URL || 'redis://localhost:6379',
    queue: queue.name,
  });
}

/**
 * Add a fix job to the queue
 */
export async function queueFixJob(
  data: FixJobData,
  options?: FixJobOptions
): Promise<string> {
  const queue = getQueue();
  const job = await queue.add('fix', data, options);

  // Create job history entry
  try {
    await jobHistoryRepo.create({
      jobId: job.id!,
      projectId: data.event.projectId,
      triggerType: data.triggerType,
      triggerId: data.event.triggerId,
    });
  } catch (error) {
    console.error('Failed to create job history entry:', error);
  }

  console.log('Job queued', {
    jobId: job.id,
    triggerType: data.triggerType,
    triggerId: data.event.triggerId,
    projectId: data.event.projectId,
  });

  return job.id!;
}

/**
 * Get queue statistics
 */
export async function getQueueStats() {
  const queue = getQueue();
  const [waiting, active, completed, failed, delayed, paused] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
    queue.getDelayedCount(),
    queue.isPaused(),
  ]);

  return {
    waiting,
    active,
    completed,
    failed,
    delayed,
    paused,
  };
}

/**
 * Pause the queue
 */
export async function pauseQueue(): Promise<void> {
  const queue = getQueue();
  await queue.pause();
  console.log('Queue paused');
}

/**
 * Resume the queue
 */
export async function resumeQueue(): Promise<void> {
  const queue = getQueue();
  await queue.resume();
  console.log('Queue resumed');
}

/**
 * Clean up queue (remove old jobs)
 */
export async function cleanQueue(): Promise<void> {
  const queue = getQueue();
  await queue.clean(24 * 3600 * 1000, 100, 'completed'); // 24 hours
  await queue.clean(7 * 24 * 3600 * 1000, 50, 'failed'); // 7 days
  console.log('Queue cleaned');
}

/**
 * Graceful shutdown
 */
export async function closeQueue(): Promise<void> {
  if (fixQueue) {
    await fixQueue.close();
    fixQueue = null;
  }
  if (connection) {
    await connection.quit();
    connection = null;
  }
  console.log('Queue closed');
}
