import { NextResponse } from 'next/server';
import {
  listRepositories,
  getAppStatus,
  getInstallUrl,
} from '@/src/github/app-service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/github/repositories
 * List all repositories accessible via our GitHub App installations
 *
 * Returns:
 * - repositories: Array of repos with name, fullName, defaultBranch, etc.
 * - installUrl: URL to install the app (if no installations exist)
 * - appConfigured: Whether the GitHub App is set up
 */
export async function GET() {
  try {
    const appStatus = await getAppStatus();
    console.log('[repositories] App status:', JSON.stringify(appStatus, null, 2));

    if (!appStatus.configured) {
      console.log('[repositories] App not configured, returning appConfigured: false');
      return NextResponse.json({
        appConfigured: false,
        repositories: [],
        message: 'GitHub App not configured. Please set up the GitHub App in Settings first.',
      });
    }

    const hasInstallations = appStatus.installations && appStatus.installations.length > 0;

    if (!hasInstallations) {
      const installUrl = await getInstallUrl();
      return NextResponse.json({
        appConfigured: true,
        hasInstallations: false,
        repositories: [],
        installUrl,
        message: 'No GitHub accounts connected. Click the button to install the GitHub App on your account or organization.',
      });
    }

    const repositories = await listRepositories();

    return NextResponse.json({
      appConfigured: true,
      hasInstallations: true,
      repositories,
      installations: appStatus.installations,
    });
  } catch (error) {
    console.error('Failed to list repositories:', error);
    return NextResponse.json(
      { error: 'Failed to list repositories' },
      { status: 500 }
    );
  }
}
