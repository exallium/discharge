import { NextRequest, NextResponse } from 'next/server';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

import { projectsRepo, settingsRepo } from '@/src/db/repositories';
import { setSecret, deleteSecret } from '@/src/secrets';
import { getProjectSecretRequirements, formatUsedBy } from '@/src/secrets/requirements';
import type { ProjectConfig } from '@/src/config/projects';
// Ensure runner plugins are registered before fetching secret requirements
import { initializeRunners } from '@/src/runner';
initializeRunners();

interface RouteParams {
  params: Promise<{ id: string }>;
}

export interface SecretStatus {
  /** Shared secret identifier (e.g., 'github_token') */
  id: string;
  /** Plugin for storage (e.g., 'github') - for backward compatibility */
  plugin: string;
  /** Key within plugin (e.g., 'token') - for backward compatibility */
  secretKey: string;
  /** Display label */
  label: string;
  /** Help text */
  description: string;
  /** Whether this secret is required */
  required: boolean;
  /** Which plugins use this secret (e.g., ['vcs', 'github-issues']) */
  usedBy: string[];
  /** Formatted usedBy for display (e.g., 'VCS, GitHub Issues') */
  usedByDisplay: string;
  /** Where the secret value comes from */
  source: 'project' | 'global' | 'env' | 'none';
  /** The actual secret value (for reveal/copy in admin UI) */
  value?: string;
  /** Masked secret value for display */
  masked: string;
}

/**
 * GET /api/projects/[id]/secrets
 * List all secrets for a project with their configuration status
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const project = await projectsRepo.findById(id);

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Convert to ProjectConfig format for aggregation
    const projectConfig: ProjectConfig = {
      id: project.id,
      repo: project.repo,
      repoFullName: project.repoFullName,
      branch: project.branch,
      vcs: project.vcs,
      runner: project.runner,
      triggers: project.triggers as ProjectConfig['triggers'],
      constraints: project.constraints,
      conversation: project.conversation,
    };

    // Get aggregated secret requirements from plugins
    const requirements = getProjectSecretRequirements(projectConfig);

    const secrets: SecretStatus[] = [];

    for (const req of requirements) {
      // Use plugin and key directly from requirement
      const { plugin, key: secretKey } = req;

      // Check each level to determine source
      const projectKey = `projects:${id}:${plugin}:${secretKey}`;
      const globalKey = `${plugin}:${secretKey}`;
      const envKey = `${plugin.toUpperCase()}_${secretKey.toUpperCase()}`;

      // Use getDecrypted to properly decrypt encrypted values
      const projectValue = await settingsRepo.getDecrypted(projectKey);
      const globalValue = await settingsRepo.getDecrypted(globalKey);
      const envValue = process.env[envKey];

      let source: 'project' | 'global' | 'env' | 'none' = 'none';
      let value: string | undefined;

      if (projectValue) {
        source = 'project';
        value = projectValue;
      } else if (globalValue) {
        source = 'global';
        value = globalValue;
      } else if (envValue) {
        source = 'env';
        value = envValue;
      }

      secrets.push({
        id: req.id,
        plugin,
        secretKey,
        label: req.label,
        description: req.description,
        required: req.required,
        usedBy: req.usedBy,
        usedByDisplay: formatUsedBy(req.usedBy),
        source,
        value,
        masked: value ? maskValue(value) : '',
      });
    }

    // Extract enabled triggers for backward compatibility
    const enabledTriggers: string[] = [];
    const triggers = project.triggers as Record<string, unknown> || {};

    if (triggers.github && typeof triggers.github === 'object') {
      const github = triggers.github as Record<string, unknown>;
      if (github.issues) enabledTriggers.push('github-issues');
    }
    if (triggers.sentry && typeof triggers.sentry === 'object') {
      const sentry = triggers.sentry as Record<string, unknown>;
      if (sentry.enabled) enabledTriggers.push('sentry');
    }
    if (triggers.circleci && typeof triggers.circleci === 'object') {
      const circleci = triggers.circleci as Record<string, unknown>;
      if (circleci.enabled) enabledTriggers.push('circleci');
    }

    return NextResponse.json({ secrets, triggers: enabledTriggers });
  } catch (error) {
    console.error('Failed to fetch project secrets:', error);
    return NextResponse.json(
      { error: 'Failed to fetch project secrets' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/projects/[id]/secrets
 * Set a project-specific secret
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const project = await projectsRepo.findById(id);

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const { plugin, key, value } = await request.json();

    if (!plugin || !key || !value) {
      return NextResponse.json(
        { error: 'Missing required fields: plugin, key, value' },
        { status: 400 }
      );
    }

    await setSecret(plugin, key, value, id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to set project secret:', error);
    return NextResponse.json(
      { error: 'Failed to set project secret' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/projects/[id]/secrets
 * Delete a project-specific secret
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const project = await projectsRepo.findById(id);

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const { plugin, key } = await request.json();

    if (!plugin || !key) {
      return NextResponse.json(
        { error: 'Missing required fields: plugin, key' },
        { status: 400 }
      );
    }

    await deleteSecret(plugin, key, id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete project secret:', error);
    return NextResponse.json(
      { error: 'Failed to delete project secret' },
      { status: 500 }
    );
  }
}

/**
 * Mask a secret value for display
 */
function maskValue(value: string): string {
  if (value.length <= 8) {
    return '••••••••';
  }
  return value.slice(0, 4) + '••••••••' + value.slice(-4);
}
