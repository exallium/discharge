import { Worker, Job } from 'bullmq';
import { getConnection } from './index';
import { FixJobData, FixJobResult } from './types';
import { getTriggerByType } from '../triggers';
import { orchestrateFix, orchestrateConversation } from '../runner/orchestrator';
import { getErrorMessage } from '../types/errors';
import {
  ConversationJobData,
  isConversationJob,
  getEventRouter,
} from '../conversation/router';
import { getConversationService } from '../conversation';
import { logger } from '../logger';
import * as jobHistoryRepo from '../db/repositories/job-history';
import { cleanupStaleWorktrees } from '../runner/workspace';

/**
 * Whether git workspaces feature is enabled
 */
const USE_GIT_WORKSPACES = process.env.USE_GIT_WORKSPACES === 'true';

/**
 * Process a fix job (handles both legacy and conversation jobs)
 */
async function processFixJob(job: Job<FixJobData>): Promise<FixJobResult> {
  const startTime = Date.now();
  const jobId = job.id!;

  // Mark job as running
  try {
    await jobHistoryRepo.markRunning(jobId);
  } catch (error) {
    console.error('Failed to mark job as running:', error);
  }

  // Check if this is a conversation job
  const conversationData = (job.data as unknown as { conversationData?: ConversationJobData }).conversationData;
  if (conversationData && isConversationJob(conversationData)) {
    return processConversationJob(job, conversationData, startTime);
  }

  // Legacy flow
  const { event, triggerType } = job.data;

  console.log(`Processing job ${jobId}`, {
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

    // Mark job as complete
    try {
      await jobHistoryRepo.complete(jobId, {
        status: 'success',
        fixed: fixStatus.fixed,
        reason: fixStatus.reason,
        prUrl: fixStatus.prUrl,
        analysis: fixStatus.analysis ? {
          fixed: fixStatus.fixed,
          reason: fixStatus.reason || '',
          confidence: fixStatus.analysis.confidence === 'high' ? 1 : fixStatus.analysis.confidence === 'medium' ? 0.5 : 0,
        } : null,
      });
    } catch (error) {
      console.error('Failed to mark job as complete:', error);
    }

    console.log(`Job ${jobId} completed`, result);
    return result;

  } catch (error) {
    const errorMessage = getErrorMessage(error);
    console.error(`Job ${jobId} failed:`, errorMessage);

    // Mark job as failed
    try {
      await jobHistoryRepo.complete(jobId, {
        status: 'failed',
        error: errorMessage,
      });
    } catch (err) {
      console.error('Failed to mark job as failed:', err);
    }

    return {
      success: false,
      fixed: false,
      reason: errorMessage,
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Process a conversation job
 */
async function processConversationJob(
  job: Job<FixJobData>,
  conversationData: ConversationJobData,
  startTime: number
): Promise<FixJobResult> {
  const {
    conversationId,
    projectId,
    triggerType,
    triggerId,
    events,
    routeMode,
    iteration,
    isInitial,
  } = conversationData;

  logger.info('Processing conversation job', {
    jobId: job.id,
    conversationId,
    projectId,
    triggerType,
    eventCount: events.length,
    routeMode,
    iteration,
    isInitial,
  });

  try {
    // Get the trigger plugin
    const trigger = getTriggerByType(triggerType);
    if (!trigger) {
      throw new Error(`Unknown trigger type: ${triggerType}`);
    }

    // Get conversation service
    const conversationService = getConversationService();

    // Run conversation orchestration
    const result = await orchestrateConversation(
      trigger,
      conversationId,
      projectId,
      events,
      routeMode,
      iteration
    );

    // Drain pending events and potentially start continuation job
    const drainResult = await conversationService.releaseLockAndDrain(conversationId);

    if (drainResult.pendingEvents.length > 0) {
      // Start a continuation job with the pending events
      // Extract the actual ConversationEvent objects from the pending entries
      const pendingConversationEvents = drainResult.pendingEvents.map(
        (entry) => entry.eventPayload
      );

      logger.info('Starting continuation job with pending events', {
        conversationId,
        pendingCount: pendingConversationEvents.length,
      });

      const eventRouter = getEventRouter();
      await eventRouter.startContinuationJob(
        conversationId,
        projectId,
        triggerType,
        triggerId,
        pendingConversationEvents,
        routeMode,
        iteration + 1
      );
    }

    // Check if result indicates an error that requires admin intervention
    const hasRunnerError = result.errorType && result.errorType !== 'transient';
    const jobStatus = hasRunnerError ? 'failed' : 'success';

    // Log admin-required errors prominently
    if (result.requiresAdminIntervention) {
      logger.warn('Conversation job requires admin intervention', {
        jobId: job.id,
        conversationId,
        errorType: result.errorType,
        response: result.response.slice(0, 200),
      });
    }

    // Mark job as complete (or failed if there was a runner error)
    try {
      await jobHistoryRepo.complete(job.id!, {
        status: jobStatus,
        fixed: result.complete || false,
        reason: result.response,
        error: hasRunnerError ? result.response : undefined,
      });
    } catch (err) {
      console.error('Failed to mark conversation job as complete:', err);
    }

    return {
      success: !hasRunnerError,
      fixed: result.complete || false,
      reason: result.response,
      prUrl: undefined, // Plan PRs are handled via VCS plugin
      duration: Date.now() - startTime,
    };
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    logger.error('Conversation job failed', {
      jobId: job.id,
      conversationId,
      error: errorMessage,
    });

    // Mark job as failed
    try {
      await jobHistoryRepo.complete(job.id!, {
        status: 'failed',
        error: errorMessage,
      });
    } catch (err) {
      console.error('Failed to mark conversation job as failed:', err);
    }

    // Try to release the lock even on failure
    const conversationService = getConversationService();
    await conversationService.releaseLockAndDrain(conversationId).catch(() => {});

    return {
      success: false,
      fixed: false,
      reason: errorMessage,
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

  worker.on('ready', async () => {
    console.log('✓ Worker ready', {
      concurrency,
      queue: 'claude-fix-jobs',
    });

    // Clean up stale worktrees on worker startup (if feature enabled)
    if (USE_GIT_WORKSPACES) {
      try {
        const removed = await cleanupStaleWorktrees();
        if (removed > 0) {
          logger.info('Cleaned up stale worktrees on startup', { removed });
        }
      } catch (error) {
        logger.warn('Failed to cleanup stale worktrees on startup', {
          error: getErrorMessage(error),
        });
      }
    }
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
