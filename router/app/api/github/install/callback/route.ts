import { NextRequest, NextResponse } from 'next/server';
import {
  storeInstallation,
  getBaseUrl,
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
 * - state: Our state parameter with projectId
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const installationId = searchParams.get('installation_id');
  const state = searchParams.get('state');
  const baseUrl = getBaseUrl();

  // Parse state to get projectId
  let projectId: string | null = null;
  if (state) {
    try {
      const decoded = JSON.parse(Buffer.from(state, 'base64url').toString());
      projectId = decoded.projectId;
    } catch {
      console.error('Failed to parse state parameter');
    }
  }

  if (!installationId) {
    const redirectUrl = projectId
      ? `${baseUrl}/projects/${projectId}?github_error=missing_installation_id`
      : `${baseUrl}/settings?github_error=missing_installation_id`;
    return NextResponse.redirect(redirectUrl);
  }

  if (!projectId) {
    return NextResponse.redirect(
      `${baseUrl}/settings?github_error=missing_project_id`
    );
  }

  try {
    // Fetch installation details from GitHub API
    const installationDetails = await fetchInstallationDetails(parseInt(installationId, 10));

    // Store the installation
    const installation: GitHubInstallation = {
      installationId: parseInt(installationId, 10),
      accountLogin: installationDetails.account.login,
      accountType: installationDetails.account.type as 'User' | 'Organization',
      repositorySelection: installationDetails.repository_selection,
      installedAt: new Date().toISOString(),
    };

    await storeInstallation(projectId, installation);

    // Redirect back to project page with success
    return NextResponse.redirect(
      `${baseUrl}/projects/${projectId}?github_connected=true&account=${encodeURIComponent(installationDetails.account.login)}`
    );
  } catch (error) {
    console.error('Failed to process installation callback:', error);
    return NextResponse.redirect(
      `${baseUrl}/projects/${projectId}?github_error=installation_failed`
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
