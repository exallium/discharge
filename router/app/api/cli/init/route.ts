/**
 * CLI Init Endpoint
 *
 * POST /api/cli/init
 *
 * Bootstrapping endpoint that uses username/password auth (not token auth)
 * to generate an API token and optionally create a project.
 *
 * This is the only CLI endpoint that accepts password auth — all others
 * use the Bearer token generated here.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyCredentials } from '@/lib/auth';
import { getDatabase, settings } from '@/src/db';
import { generateApiToken } from '@/src/middleware/api-token';
import { projectsRepo } from '@/src/db/repositories';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { username, password, project } = body as {
      username: string;
      password: string;
      project?: {
        id: string;
        repoFullName: string;
        repo: string;
        branch: string;
        vcsType?: string;
      };
    };

    // Validate credentials
    if (!username || !password) {
      return NextResponse.json(
        { error: 'Username and password are required' },
        { status: 400 }
      );
    }

    const valid = await verifyCredentials(username, password);
    if (!valid) {
      return NextResponse.json(
        { error: 'Invalid credentials' },
        { status: 401 }
      );
    }

    // Generate API token
    const { token, hash } = generateApiToken();
    const key = `api_token_${hash.slice(0, 12)}`;
    const label = `CLI Init (${new Date().toISOString().slice(0, 10)})`;

    const db = getDatabase();
    await db.insert(settings).values({
      key,
      value: hash,
      encrypted: false,
      description: label,
      category: 'api_token',
    });

    // Create or find project
    let projectResult: { id: string; created: boolean } | undefined;

    if (project) {
      const existing = await projectsRepo.findById(project.id);
      if (existing) {
        // Project exists — enable kanban trigger if not already
        const triggers = (existing.triggers || {}) as Record<string, unknown>;
        if (!triggers.kanban) {
          triggers.kanban = { enabled: true };
          await projectsRepo.update(project.id, { triggers });
        }
        projectResult = { id: existing.id, created: false };
      } else {
        // Parse owner/repo from repoFullName
        const [owner, repo] = project.repoFullName.split('/');

        await projectsRepo.create({
          id: project.id,
          repoFullName: project.repoFullName,
          repo: project.repo,
          branch: project.branch,
          vcs: {
            type: (project.vcsType as 'github' | 'gitlab' | 'bitbucket' | 'self-hosted') || 'github',
            owner: owner || '',
            repo: repo || '',
          },
          triggers: {
            kanban: { enabled: true },
          },
        });
        projectResult = { id: project.id, created: true };
      }
    }

    return NextResponse.json({
      token,
      tokenKey: key,
      project: projectResult,
    }, { status: 201 });
  } catch (error) {
    console.error('CLI init error:', error);
    return NextResponse.json(
      { error: 'Init failed' },
      { status: 500 }
    );
  }
}
