import { NextRequest, NextResponse } from 'next/server';
import {
  getInstallUrl,
  getInstallationStatus,
  deleteInstallation,
  isAppConfigured,
} from '@/src/github/app-service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/github/install?projectId=xxx
 * Get installation status for a project, or redirect to install
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const projectId = searchParams.get('projectId');
  const redirect = searchParams.get('redirect') === 'true';

  if (!projectId) {
    return NextResponse.json(
      { error: 'Missing projectId parameter' },
      { status: 400 }
    );
  }

  // Check if app is configured first
  const appConfigured = await isAppConfigured();
  if (!appConfigured) {
    return NextResponse.json(
      { error: 'GitHub App not configured. Please set up the GitHub App first.' },
      { status: 400 }
    );
  }

  // If redirect requested, send user to GitHub
  if (redirect) {
    const installUrl = await getInstallUrl(projectId);
    if (!installUrl) {
      return NextResponse.json(
        { error: 'Failed to generate install URL' },
        { status: 500 }
      );
    }
    return NextResponse.redirect(installUrl);
  }

  // Otherwise return status
  try {
    const status = await getInstallationStatus(projectId);
    return NextResponse.json(status);
  } catch (error) {
    console.error('Failed to get installation status:', error);
    return NextResponse.json(
      { error: 'Failed to get installation status' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/github/install?projectId=xxx
 * Remove GitHub installation for a project
 */
export async function DELETE(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const projectId = searchParams.get('projectId');

  if (!projectId) {
    return NextResponse.json(
      { error: 'Missing projectId parameter' },
      { status: 400 }
    );
  }

  try {
    await deleteInstallation(projectId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete installation:', error);
    return NextResponse.json(
      { error: 'Failed to delete installation' },
      { status: 500 }
    );
  }
}
