import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import {
  getAppStatus,
  deleteAppCredentials,
  generateAppManifest,
} from '@/src/github/app-service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/github/app
 * Get GitHub App configuration status
 */
export async function GET() {
  try {
    const status = await getAppStatus();
    return NextResponse.json(status);
  } catch (error) {
    console.error('Failed to get GitHub App status:', error);
    return NextResponse.json(
      { error: 'Failed to get GitHub App status' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/github/app
 * Start GitHub App creation flow
 * Returns a URL to redirect the user to GitHub
 */
export async function POST() {
  try {
    const headersList = await headers();
    const host = headersList.get('x-forwarded-host') || headersList.get('host') || 'localhost:3000';
    const protocol = headersList.get('x-forwarded-proto') || 'http';
    const baseUrl = `${protocol}://${host}`;
    const manifest = generateAppManifest(baseUrl);

    // Return the URL and manifest for the client to redirect
    // The client will submit a form to GitHub with the manifest
    return NextResponse.json({
      url: 'https://github.com/settings/apps/new',
      manifest: JSON.stringify(manifest),
    });
  } catch (error) {
    console.error('Failed to generate GitHub App manifest:', error);
    return NextResponse.json(
      { error: 'Failed to generate manifest' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/github/app
 * Remove GitHub App configuration
 */
export async function DELETE() {
  try {
    await deleteAppCredentials();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete GitHub App:', error);
    return NextResponse.json(
      { error: 'Failed to delete GitHub App configuration' },
      { status: 500 }
    );
  }
}
