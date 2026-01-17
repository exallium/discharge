import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

/**
 * GET /api/github/install/setup
 * Optional setup URL called after installation
 * Redirects to the callback handler
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  // Get base URL from request headers
  const headersList = await headers();
  const host = headersList.get('x-forwarded-host') || headersList.get('host') || 'localhost:3000';
  const protocol = headersList.get('x-forwarded-proto') || 'http';
  const baseUrl = `${protocol}://${host}`;

  // Forward all params to the callback
  const callbackUrl = new URL(`${baseUrl}/api/github/install/callback`);
  searchParams.forEach((value, key) => {
    callbackUrl.searchParams.set(key, value);
  });

  return NextResponse.redirect(callbackUrl.toString());
}
