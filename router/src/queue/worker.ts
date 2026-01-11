import { Worker, Job } from 'bullmq';
import { getConnection } from './index';
import { FixJobData, FixJobResult } from './types';
import { getTriggerByType } from '../triggers';
import { orchestrateFix } from '../runner/orchestrator';
import { getErrorMessage } from '../types/errors';

/**
 * Process a fix job
 */
async function processFixJob(job: Job<FixJobData>): Promise<FixJobResult> {
  const startTime = Date.now();
  const { event, triggerType } = job.data;

  console.log(`Processing job ${job.id}`, {
    triggerType,
    triggerId: event.triggerId,
    projectId: event.projectId,
    title: event.title,
  });

  try {
    // Get the trigger plugin
    const trigger = getTriggerByType(triggerType);
    if (!trigger) {
      throw new Error(`Unknown trigger type: ${triggerType}`);
    }

    // Run orchestrator
    const fixStatus = await orchestrateFix(trigger, event);

    const result: FixJobResult = {
      success: true,
      fixed: fixStatus.fixed,
      reason: fixStatus.reason,
      prUrl: fixStatus.prUrl,
      duration: Date.now() - startTime,
    };

    console.log(`Job ${job.id} completed`, result);
    return result;

  } catch (error) {
    console.error(`Job ${job.id} failed:`, getErrorMessage(error));

    return {
      success: false,
      fixed: false,
      reason: getErrorMessage(error),
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Create and start the worker
 */
export function createWorker(concurrency = 2) {
  const worker = new Worker<FixJobData, FixJobResult>(
    'claude-fix-jobs',
    processFixJob,
    {
      connection: getConnection() as never, // Type assertion for ioredis version mismatch
      concurrency,
      limiter: {
        max: 10, // Max 10 jobs per duration
        duration: 60000, // Per minute
      },
    }
  );

  // Event handlers
  worker.on('completed', (job, result) => {
    console.log(`✓ Job ${job.id} completed`, {
      fixed: result.fixed,
      duration: `${result.duration}ms`,
    });
  });

  worker.on('failed', (job, error) => {
    console.error(`✗ Job ${job?.id} failed:`, error.message);
  });

  worker.on('error', (error) => {
    console.error('Worker error:', error);
  });

  worker.on('ready', () => {
    console.log('✓ Worker ready', {
      concurrency,
      queue: 'claude-fix-jobs',
    });
  });

  return worker;
}

/**
 * Graceful worker shutdown
 */
export async function shutdownWorker(worker: Worker): Promise<void> {
  console.log('Shutting down worker...');
  await worker.close();
  console.log('Worker shut down');
}
