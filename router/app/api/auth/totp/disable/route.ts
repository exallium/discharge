import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

import { getSession, verifyCredentials } from '@/lib/auth';
import { disableTotp, isTotpEnabled } from '@/lib/totp';
import { trustedDevicesRepo } from '@/src/db/repositories';

/**
 * POST /api/auth/totp/disable
 * Disable TOTP (requires password confirmation)
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();

    if (!session.isLoggedIn) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { password } = await request.json();

    if (!password) {
      return NextResponse.json(
        { error: 'Password is required to disable 2FA' },
        { status: 400 }
      );
    }

    // Verify password
    const valid = await verifyCredentials(session.username, password);
    if (!valid) {
      return NextResponse.json(
        { error: 'Invalid password' },
        { status: 401 }
      );
    }

    // Check if TOTP is actually enabled
    const enabled = await isTotpEnabled();
    if (!enabled) {
      return NextResponse.json(
        { error: 'TOTP is not enabled' },
        { status: 400 }
      );
    }

    // Disable TOTP
    await disableTotp();

    // Revoke all trusted devices
    await trustedDevicesRepo.revokeAll(session.username);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('TOTP disable error:', error);
    return NextResponse.json(
      { error: 'Failed to disable TOTP' },
      { status: 500 }
    );
  }
}
