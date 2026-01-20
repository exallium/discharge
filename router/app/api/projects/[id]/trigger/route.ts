import { NextRequest, NextResponse } from 'next/server';
import { projectsRepo } from '@/src/db/repositories';
import { queueFixJob } from '@/src/queue';
import type { TriggerEvent } from '@/src/triggers/base';

export const dynamic = 'force-dynamic';

interface TriggerRequest {
  title: string;
  description: string;
  mode: 'triage' | 'investigate';
  issueUrl?: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
}

/**
 * POST /api/projects/[id]/trigger
 * Manually trigger a triage or investigation job
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params;
    const body: TriggerRequest = await request.json();

    // Validate request
    if (!body.title || !body.description) {
      return NextResponse.json(
        { error: 'Title and description are required' },
        { status: 400 }
      );
    }

    if (!body.mode || !['triage', 'investigate'].includes(body.mode)) {
      return NextResponse.json(
        { error: 'Mode must be "triage" or "investigate"' },
        { status: 400 }
      );
    }

    // Get project
    const project = await projectsRepo.findById(projectId);
    if (!project) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }

    // Create a manual trigger event
    const triggerId = `manual-${Date.now()}`;
    const event: TriggerEvent = {
      triggerType: 'manual',
      triggerId,
      projectId,
      title: body.title,
      description: body.description,
      metadata: {
        severity: body.severity || 'medium',
        tags: ['manual-trigger'],
        mode: body.mode,
        issueUrl: body.issueUrl,
      },
      links: body.issueUrl ? { web: body.issueUrl } : undefined,
      raw: body,
    };

    // Queue the job
    const jobId = await queueFixJob({
      event,
      triggerType: 'manual',
      queuedAt: new Date().toISOString(),
    });

    return NextResponse.json({
      success: true,
      jobId,
      triggerId,
      mode: body.mode,
      message: body.mode === 'triage'
        ? 'Full triage job queued - will investigate and fix if actionable'
        : 'Investigation job queued - will analyze without making changes',
    });
  } catch (error) {
    console.error('Failed to trigger job:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to trigger job' },
      { status: 500 }
    );
  }
}
