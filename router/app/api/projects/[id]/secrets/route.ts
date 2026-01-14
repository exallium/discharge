import { NextRequest, NextResponse } from 'next/server';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

import { projectsRepo } from '@/src/db/repositories';
import { setSecret, deleteSecret } from '@/src/secrets';

/**
 * Secret requirements per trigger type
 */
const TRIGGER_SECRETS: Record<string, { key: string; label: string; description: string }[]> = {
  'github-issues': [
    { key: 'github:token', label: 'GitHub Token', description: 'Personal access token for GitHub API' },
    { key: 'github:webhook_secret', label: 'Webhook Secret', description: 'Secret for validating webhook signatures' },
  ],
  sentry: [
    { key: 'sentry:auth_token', label: 'Auth Token', description: 'Sentry API authentication token' },
    { key: 'sentry:webhook_secret', label: 'Webhook Secret', description: 'Secret for validating webhook signatures' },
  ],
  circleci: [
    { key: 'circleci:token', label: 'API Token', description: 'CircleCI API token' },
    { key: 'circleci:webhook_secret', label: 'Webhook Secret', description: 'Secret for validating webhook signatures' },
  ],
};

interface RouteParams {
  params: Promise<{ id: string }>;
}

export interface SecretStatus {
  key: string;
  plugin: string;
  secretKey: string;
  label: string;
  description: string;
  source: 'project' | 'global' | 'env' | 'none';
  value?: string; // Only included if configured
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

    const enabledTriggers = Object.keys(project.triggers || {});
    const secrets: SecretStatus[] = [];

    for (const trigger of enabledTriggers) {
      const triggerSecrets = TRIGGER_SECRETS[trigger] || [];

      for (const secretDef of triggerSecrets) {
        const [plugin, secretKey] = secretDef.key.split(':');

        // Check each level to determine source
        const projectKey = `projects:${id}:${plugin}:${secretKey}`;
        const globalKey = `${plugin}:${secretKey}`;
        const envKey = `${plugin.toUpperCase()}_${secretKey.toUpperCase()}`;

        // Import settingsRepo to check specific levels
        const { settingsRepo } = await import('@/src/db/repositories');

        const projectValue = await settingsRepo.get(projectKey);
        const globalValue = await settingsRepo.get(globalKey);
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
          key: secretDef.key,
          plugin,
          secretKey,
          label: secretDef.label,
          description: secretDef.description,
          source,
          value,
          masked: value ? maskValue(value) : '',
        });
      }
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
