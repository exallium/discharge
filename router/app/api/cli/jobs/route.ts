/**
 * CLI Jobs API
 *
 * POST /api/cli/jobs - Submit a new task
 * GET  /api/cli/jobs - List jobs
 */

import { NextRequest, NextResponse } from 'next/server';
import { validateApiToken } from '@/src/middleware/api-token';
import { queueFixJob } from '@/src/queue';
import * as jobHistoryRepo from '@/src/db/repositories/job-history';
import { findProjectById } from '@/src/config/projects';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  // Auth check
  const authError = await validateApiToken(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { projectId, title, description, mode, skipPR, severity, gitAuthor } = body;

    if (!projectId || !title) {
      return NextResponse.json(
        { error: 'Missing required fields: projectId, title' },
        { status: 400 }
      );
    }

    // Verify project exists
    const project = await findProjectById(projectId);
    if (!project) {
      return NextResponse.json(
        { error: `Project not found: ${projectId}` },
        { status: 404 }
      );
    }

    // Build trigger event
    const event = {
      triggerType: 'kanban',
      triggerId: `cli-${Date.now()}`,
      projectId,
      title,
      description: description || title,
      metadata: {
        source: 'cli' as const,
        skipPR: skipPR ?? true,
        executionMode: 'local' as const,
        mode,
        severity,
        gitAuthor,
      },
      raw: body,
    };

    // Queue the job
    const jobId = await queueFixJob(
      {
        event,
        triggerType: 'kanban',
        queuedAt: new Date().toISOString(),
      },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      }
    );

    return NextResponse.json(
      {
        jobId,
        status: 'queued',
        projectId,
        title,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Failed to submit CLI job:', error);
    return NextResponse.json(
      { error: 'Failed to submit job' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  // Auth check
  const authError = await validateApiToken(request);
  if (authError) return authError;

  try {
    const { searchParams } = request.nextUrl;
    const projectId = searchParams.get('projectId');
    const limit = parseInt(searchParams.get('limit') || '20', 10);
    const status = searchParams.get('status') || undefined;

    if (!projectId) {
      return NextResponse.json(
        { error: 'Missing required query parameter: projectId' },
        { status: 400 }
      );
    }

    const jobs = await jobHistoryRepo.findByProjectFiltered(projectId, {
      limit,
      status,
    });

    return NextResponse.json({ jobs });
  } catch (error) {
    console.error('Failed to list CLI jobs:', error);
    return NextResponse.json(
      { error: 'Failed to list jobs' },
      { status: 500 }
    );
  }
}
