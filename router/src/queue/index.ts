import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { FixJobData, FixJobOptions } from './types';

/**
 * Parse Redis URL into connection options
 */
function getRedisOptions() {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  return {
    connection: {
      url: redisUrl,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    } as any, // Type assertion to work around BullMQ/ioredis version mismatch
  };
}

/**
 * Redis connection for queue operations
 */
export const connection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

/**
 * Main job queue for fix jobs
 */
export const fixQueue = new Queue<FixJobData>('claude-fix-jobs', {
  ...getRedisOptions(),
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

/**
 * Initialize the queue
 */
export async function initializeQueue(): Promise<void> {
  // Wait for Redis connection
  await connection.ping();

  console.log('✓ Queue initialized', {
    redis: process.env.REDIS_URL || 'redis://localhost:6379',
    queue: fixQueue.name,
  });
}

/**
 * Add a fix job to the queue
 */
export async function queueFixJob(
  data: FixJobData,
  options?: FixJobOptions
): Promise<string> {
  const job = await fixQueue.add('fix' as any, data, options);

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
  const [waiting, active, completed, failed, delayed, paused] = await Promise.all([
    fixQueue.getWaitingCount(),
    fixQueue.getActiveCount(),
    fixQueue.getCompletedCount(),
    fixQueue.getFailedCount(),
    fixQueue.getDelayedCount(),
    fixQueue.isPaused(),
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
  await fixQueue.pause();
  console.log('Queue paused');
}

/**
 * Resume the queue
 */
export async function resumeQueue(): Promise<void> {
  await fixQueue.resume();
  console.log('Queue resumed');
}

/**
 * Clean up queue (remove old jobs)
 */
export async function cleanQueue(): Promise<void> {
  await fixQueue.clean(24 * 3600 * 1000, 100, 'completed'); // 24 hours
  await fixQueue.clean(7 * 24 * 3600 * 1000, 50, 'failed'); // 7 days
  console.log('Queue cleaned');
}

/**
 * Graceful shutdown
 */
export async function closeQueue(): Promise<void> {
  await fixQueue.close();
  await connection.quit();
  console.log('Queue closed');
}
