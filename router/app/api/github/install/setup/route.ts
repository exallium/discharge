import { NextRequest, NextResponse } from 'next/server';
import { getBaseUrl } from '@/src/github/app-service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/github/install/setup
 * Optional setup URL called after installation
 * Redirects to the callback handler
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const baseUrl = getBaseUrl();

  // Forward all params to the callback
  const callbackUrl = new URL(`${baseUrl}/api/github/install/callback`);
  searchParams.forEach((value, key) => {
    callbackUrl.searchParams.set(key, value);
  });

  return NextResponse.redirect(callbackUrl.toString());
}
