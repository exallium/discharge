import { NextRequest, NextResponse } from 'next/server';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

import { projectsRepo } from '@/src/db/repositories';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const project = await projectsRepo.findById(id);
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const updated = await projectsRepo.update(id, {
      enabled: !project.enabled,
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Failed to toggle project:', error);
    return NextResponse.json(
      { error: 'Failed to toggle project' },
      { status: 500 }
    );
  }
}
