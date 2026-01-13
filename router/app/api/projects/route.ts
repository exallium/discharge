import { NextRequest, NextResponse } from 'next/server';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

import { projectsRepo } from '@/src/db/repositories';

export async function GET(request: NextRequest) {
  try {
    const includeDisabled =
      request.nextUrl.searchParams.get('includeDisabled') === 'true';
    const projects = await projectsRepo.findAll(includeDisabled);
    return NextResponse.json(projects);
  } catch (error) {
    console.error('Failed to fetch projects:', error);
    return NextResponse.json(
      { error: 'Failed to fetch projects' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate required fields
    const requiredFields = ['id', 'repoFullName', 'repo', 'branch', 'vcs'];
    for (const field of requiredFields) {
      if (!body[field]) {
        return NextResponse.json(
          { error: `Missing required field: ${field}` },
          { status: 400 }
        );
      }
    }

    // Check if project already exists
    const existing = await projectsRepo.findById(body.id);
    if (existing) {
      return NextResponse.json(
        { error: 'Project with this ID already exists' },
        { status: 409 }
      );
    }

    // Create project
    const project = await projectsRepo.create({
      id: body.id,
      repoFullName: body.repoFullName,
      repo: body.repo,
      branch: body.branch,
      vcs: body.vcs,
      runner: body.runner || undefined,
      triggers: body.triggers || {},
      constraints: body.constraints || undefined,
      conversation: body.conversation || undefined,
    });

    return NextResponse.json(project, { status: 201 });
  } catch (error) {
    console.error('Failed to create project:', error);
    return NextResponse.json(
      { error: 'Failed to create project' },
      { status: 500 }
    );
  }
}
