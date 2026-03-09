/**
 * CLI Job Stream API (SSE)
 *
 * GET /api/cli/jobs/[jobId]/stream - SSE stream for `discharge watch`
 */

import { NextRequest } from 'next/server';
import { validateApiToken } from '@/src/middleware/api-token';
import * as jobHistoryRepo from '@/src/db/repositories/job-history';
import Redis from 'ioredis';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  // Auth check
  const authError = await validateApiToken(request);
  if (authError) return authError;

  const { jobId } = await params;

  // Check if job exists
  const job = await jobHistoryRepo.findByJobId(jobId);
  if (!job) {
    return new Response(JSON.stringify({ error: 'Job not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // If job is already complete, return final status immediately
  if (job.status === 'success' || job.status === 'failed' || job.status === 'skipped') {
    const encoder = new TextEncoder();
    const body = encoder.encode(
      `data: ${JSON.stringify({ type: 'job_' + (job.status === 'success' ? 'completed' : job.status), data: { jobId: job.jobId, status: job.status, fixed: job.fixed, branchName: job.branchName, reason: job.reason, error: job.error } })}\n\n`
    );
    return new Response(body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  }

  // Stream events via Redis pub/sub
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
      const subscriber = new Redis(redisUrl, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
      });

      const channel = `conversation:${jobId}`;
      let closed = false;

      const cleanup = async () => {
        if (closed) return;
        closed = true;
        try {
          await subscriber.unsubscribe(channel);
          await subscriber.quit();
        } catch {
          // ignore cleanup errors
        }
      };

      // Send initial status
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: 'status', data: { jobId: job.jobId, status: job.status } })}\n\n`)
      );

      // Listen for events
      subscriber.on('message', (_ch, message) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${message}\n\n`));
          const event = JSON.parse(message);
          // Close stream on terminal events
          if (event.type === 'job_completed' || event.type === 'job_failed') {
            cleanup().then(() => controller.close()).catch(() => {});
          }
        } catch {
          // ignore parse errors
        }
      });

      subscriber.on('error', () => {
        cleanup().then(() => controller.close()).catch(() => {});
      });

      await subscriber.subscribe(channel);

      // Heartbeat + poll for completion (in case pub/sub misses it)
      const interval = setInterval(async () => {
        if (closed) {
          clearInterval(interval);
          return;
        }
        try {
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
          // Check if job completed while we were waiting
          const currentJob = await jobHistoryRepo.findByJobId(jobId);
          if (currentJob && (currentJob.status === 'success' || currentJob.status === 'failed' || currentJob.status === 'skipped')) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: 'job_' + (currentJob.status === 'success' ? 'completed' : currentJob.status), data: { jobId: currentJob.jobId, status: currentJob.status, fixed: currentJob.fixed, branchName: currentJob.branchName, reason: currentJob.reason, error: currentJob.error } })}\n\n`)
            );
            clearInterval(interval);
            await cleanup();
            controller.close();
          }
        } catch {
          // ignore polling errors
        }
      }, 10000);

      // Handle client disconnect
      request.signal.addEventListener('abort', () => {
        clearInterval(interval);
        cleanup().catch(() => {});
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
