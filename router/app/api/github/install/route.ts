import { NextRequest, NextResponse } from 'next/server';
import {
  getInstallUrl,
  getInstallationsStatus,
  deleteInstallationByAccount,
  isAppConfigured,
} from '@/src/github/app-service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/github/install
 * Get installation status and install URL
 *
 * No longer requires projectId - installations are account-level
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const redirect = searchParams.get('redirect') === 'true';

  // Check if app is configured first
  const appConfigured = await isAppConfigured();
  if (!appConfigured) {
    return NextResponse.json({
      appConfigured: false,
      error: 'GitHub App not configured. Please set up the GitHub App in Settings first.',
    });
  }

  // If redirect requested, send user to GitHub
  if (redirect) {
    const installUrl = await getInstallUrl();
    if (!installUrl) {
      return NextResponse.json(
        { error: 'Failed to generate install URL' },
        { status: 500 }
      );
    }
    return NextResponse.redirect(installUrl);
  }

  // Return status with install URL
  try {
    const status = await getInstallationsStatus();
    const installUrl = await getInstallUrl();

    return NextResponse.json({
      appConfigured: true,
      ...status,
      installUrl,
    });
  } catch (error) {
    console.error('Failed to get installation status:', error);
    return NextResponse.json(
      { error: 'Failed to get installation status' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/github/install?account=xxx
 * Remove GitHub installation for an account
 */
export async function DELETE(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const account = searchParams.get('account');

  if (!account) {
    return NextResponse.json(
      { error: 'Missing account parameter' },
      { status: 400 }
    );
  }

  try {
    await deleteInstallationByAccount(account);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete installation:', error);
    return NextResponse.json(
      { error: 'Failed to delete installation' },
      { status: 500 }
    );
  }
}
