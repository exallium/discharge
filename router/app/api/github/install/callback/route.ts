import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import {
  storeInstallation,
  GitHubInstallation,
} from '@/src/github/app-service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/github/install/callback
 * Handle GitHub App installation callback
 * GitHub redirects here after the user installs/authorizes the app
 *
 * Query params from GitHub:
 * - installation_id: The installation ID
 * - setup_action: 'install' | 'update' | 'request'
 * - state: Optional state parameter (for future use)
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const installationId = searchParams.get('installation_id');

  // Get base URL from request headers
  const headersList = await headers();
  const host = headersList.get('x-forwarded-host') || headersList.get('host') || 'localhost:3000';
  const protocol = headersList.get('x-forwarded-proto') || 'http';
  const baseUrl = `${protocol}://${host}`;

  if (!installationId) {
    return NextResponse.redirect(
      `${baseUrl}/projects/new?github_error=missing_installation_id`
    );
  }

  try {
    // Fetch installation details from GitHub API
    const installationDetails = await fetchInstallationDetails(parseInt(installationId, 10));

    // Store the installation by account (not by project)
    const installation: GitHubInstallation = {
      installationId: parseInt(installationId, 10),
      accountLogin: installationDetails.account.login,
      accountType: installationDetails.account.type as 'User' | 'Organization',
      repositorySelection: installationDetails.repository_selection,
      installedAt: new Date().toISOString(),
    };

    await storeInstallation(installationDetails.account.login, installation);

    // Redirect to project creation page with success message
    // User can now select repositories from this installation
    return NextResponse.redirect(
      `${baseUrl}/projects/new?github_connected=true&account=${encodeURIComponent(installationDetails.account.login)}`
    );
  } catch (error) {
    console.error('Failed to process installation callback:', error);
    return NextResponse.redirect(
      `${baseUrl}/projects/new?github_error=installation_failed`
    );
  }
}

/**
 * Fetch installation details from GitHub API
 * We use the installation ID to get account info
 */
async function fetchInstallationDetails(installationId: number): Promise<{
  account: { login: string; type: string };
  repository_selection: 'all' | 'selected';
}> {
  // We need to use app authentication to fetch installation details
  // Import here to avoid circular dependency
  const { getAppOctokit } = await import('@/src/github/app-service');

  const octokit = await getAppOctokit();
  if (!octokit) {
    throw new Error('GitHub App not configured');
  }

  const { data } = await octokit.rest.apps.getInstallation({
    installation_id: installationId,
  });

  return {
    account: {
      login: (data.account as { login: string }).login,
      type: (data.account as { type: string }).type,
    },
    repository_selection: data.repository_selection as 'all' | 'selected',
  };
}
