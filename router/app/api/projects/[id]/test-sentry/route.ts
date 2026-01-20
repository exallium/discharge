import { NextRequest, NextResponse } from 'next/server';
import { getSecret } from '@/src/secrets';
import { findProjectById } from '@/src/config/projects';

export const dynamic = 'force-dynamic';

interface SentryProject {
  id: string;
  slug: string;
  name: string;
  organization: {
    slug: string;
    name: string;
  };
}

/**
 * Test Sentry connection for a project
 * Verifies the auth token works and has correct permissions by fetching the configured project
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params;

    // Get project config
    const project = await findProjectById(projectId);
    if (!project) {
      return NextResponse.json(
        { success: false, message: 'Project not found' },
        { status: 404 }
      );
    }

    // Get Sentry config from project
    const sentryOrg = project.triggers?.sentry?.organization;
    const sentryProject = project.triggers?.sentry?.projectSlug;
    const instanceUrl = project.triggers?.sentry?.instanceUrl || 'https://sentry.io';

    if (!sentryOrg || !sentryProject) {
      return NextResponse.json({
        success: false,
        message: 'Sentry organization and project must be configured in .ai-bugs.json',
      });
    }

    // Get Sentry auth token
    const authToken = await getSecret('sentry', 'auth_token', projectId);
    if (!authToken) {
      return NextResponse.json({
        success: false,
        message: 'Sentry Auth Token not configured. Add it in the Secrets section below.',
      });
    }

    // Check client secret is configured (can't verify correctness without a real webhook)
    const clientSecret = await getSecret('sentry', 'webhook_secret', projectId);
    if (!clientSecret) {
      return NextResponse.json({
        success: false,
        message: 'Sentry Client Secret not configured. Add it in the Secrets section below.',
      });
    }

    // Test the token by fetching the configured project directly (only needs project:read)
    const response = await fetch(
      `${instanceUrl}/api/0/projects/${sentryOrg}/${sentryProject}/`,
      {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      }
    );

    if (!response.ok) {
      if (response.status === 401) {
        return NextResponse.json({
          success: false,
          message: 'Invalid auth token. Check that the token is correct and not expired.',
        });
      }
      if (response.status === 403) {
        return NextResponse.json({
          success: false,
          message: 'Token lacks project:read permission for this project.',
        });
      }
      if (response.status === 404) {
        return NextResponse.json({
          success: false,
          message: `Project not found: ${sentryOrg}/${sentryProject}. Check your .ai-bugs.json config.`,
        });
      }
      return NextResponse.json({
        success: false,
        message: `Sentry API error: ${response.status} ${response.statusText}`,
      });
    }

    const sentryProjectData: SentryProject = await response.json();

    return NextResponse.json({
      success: true,
      message: 'Connection successful!',
      details: {
        organization: sentryProjectData.organization?.name || sentryOrg,
        project: sentryProjectData.name || sentryProject,
      },
    });
  } catch (error) {
    console.error('Sentry connection test failed:', error);
    return NextResponse.json({
      success: false,
      message: error instanceof Error ? error.message : 'Connection test failed',
    });
  }
}
