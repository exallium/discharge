import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import {
  exchangeManifestCode,
  storeAppCredentials,
} from '@/src/github/app-service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/github/app/callback
 * Handle GitHub App creation callback
 * GitHub redirects here after the user creates the app from manifest
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');

  // Get base URL from request headers
  const headersList = await headers();
  const host = headersList.get('x-forwarded-host') || headersList.get('host') || 'localhost:3000';
  const protocol = headersList.get('x-forwarded-proto') || 'http';
  const baseUrl = `${protocol}://${host}`;

  if (!code) {
    // Redirect to settings with error
    return NextResponse.redirect(
      `${baseUrl}/settings?github_app_error=missing_code`
    );
  }

  try {
    // Exchange the code for app credentials
    const credentials = await exchangeManifestCode(code);

    // Store credentials
    await storeAppCredentials(credentials);

    // Redirect to settings with success
    return NextResponse.redirect(
      `${baseUrl}/settings?github_app_created=true&app_name=${encodeURIComponent(credentials.appName)}`
    );
  } catch (error) {
    console.error('Failed to exchange manifest code:', error);

    // Redirect to settings with error
    return NextResponse.redirect(
      `${baseUrl}/settings?github_app_error=exchange_failed`
    );
  }
}
