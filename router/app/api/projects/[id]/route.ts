import { NextRequest, NextResponse } from 'next/server';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

import { projectsRepo } from '@/src/db/repositories';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const project = await projectsRepo.findById(id);
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    return NextResponse.json(project);
  } catch (error) {
    console.error('Failed to fetch project:', error);
    return NextResponse.json(
      { error: 'Failed to fetch project' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const existing = await projectsRepo.findById(id);
    if (!existing) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const body = await request.json();

    // Handle conversation explicitly - when disabled, the form sends null
    // Pass null through to the database (not undefined) so the update actually happens
    const conversation = 'conversation' in body
      ? body.conversation  // Keep null as null, object as object
      : existing.conversation;

    const updated = await projectsRepo.update(id, {
      repoFullName: body.repoFullName ?? existing.repoFullName,
      repo: body.repo ?? existing.repo,
      branch: body.branch ?? existing.branch,
      vcs: body.vcs ?? existing.vcs,
      runner: body.runner ?? existing.runner,
      triggers: body.triggers ?? existing.triggers,
      constraints: body.constraints ?? existing.constraints,
      conversation,
      enabled: body.enabled ?? existing.enabled,
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Failed to update project:', error);
    return NextResponse.json(
      { error: 'Failed to update project' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const existing = await projectsRepo.findById(id);
    if (!existing) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    await projectsRepo.remove(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete project:', error);
    return NextResponse.json(
      { error: 'Failed to delete project' },
      { status: 500 }
    );
  }
}
