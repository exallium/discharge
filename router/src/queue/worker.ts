import { Worker, Job } from 'bullmq';
import { connection } from './index';
import { FixJobData, FixJobResult } from './types';
import { getSourceByType } from '../sources';
import { orchestrateFix } from '../runner/orchestrator';

/**
 * Process a fix job
 */
async function processFixJob(job: Job<FixJobData>): Promise<FixJobResult> {
  const startTime = Date.now();
  const { event, sourceType } = job.data;

  console.log(`Processing job ${job.id}`, {
    sourceType,
    sourceId: event.sourceId,
    projectId: event.projectId,
    title: event.title,
  });

  try {
    // Get the source plugin
    const source = getSourceByType(sourceType);
    if (!source) {
      throw new Error(`Unknown source type: ${sourceType}`);
    }

    // Run orchestrator
    const fixStatus = await orchestrateFix(source, event);

    const result: FixJobResult = {
      success: true,
      fixed: fixStatus.fixed,
      reason: fixStatus.reason,
      prUrl: fixStatus.prUrl,
      duration: Date.now() - startTime,
    };

    console.log(`Job ${job.id} completed`, result);
    return result;

  } catch (error: any) {
    console.error(`Job ${job.id} failed:`, error);

    return {
      success: false,
      fixed: false,
      reason: error.message,
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
      connection,
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
