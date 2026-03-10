/**
 * CLI Auth Verify Endpoint
 *
 * POST /api/cli/verify
 *
 * Lightweight credential check — verifies username/password without
 * generating a token or creating anything. Used by `discharge init`
 * to fail fast before collecting project details.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyCredentials } from '@/lib/auth';
import { authRateLimiter } from '@/src/middleware/rate-limit';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || request.headers.get('x-real-ip')
      || 'unknown';
    const limit = authRateLimiter(ip);
    if (limit.limited) {
      return NextResponse.json(
        { error: 'Too many attempts. Try again later.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil((limit.retryAfterMs || 0) / 1000)) } }
      );
    }

    const { username, password } = await request.json();

    if (!username || !password) {
      return NextResponse.json(
        { error: 'Username and password are required' },
        { status: 400 }
      );
    }

    const valid = await verifyCredentials(username, password);
    if (!valid) {
      return NextResponse.json(
        { error: 'Invalid credentials' },
        { status: 401 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('CLI verify error:', error);
    return NextResponse.json(
      { error: 'Verification failed' },
      { status: 500 }
    );
  }
}
