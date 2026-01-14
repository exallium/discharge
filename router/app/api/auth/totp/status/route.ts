import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

import { getSession } from '@/lib/auth';
import { isTotpEnabled, getBackupCodeCount } from '@/lib/totp';

/**
 * GET /api/auth/totp/status
 * Get TOTP status (enabled/disabled and backup code count)
 */
export async function GET() {
  try {
    const session = await getSession();

    if (!session.isLoggedIn) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const enabled = await isTotpEnabled();
    const backupCodeCount = enabled ? await getBackupCodeCount() : 0;

    return NextResponse.json({
      enabled,
      backupCodeCount,
    });
  } catch (error) {
    console.error('TOTP status error:', error);
    return NextResponse.json(
      { error: 'Failed to get TOTP status' },
      { status: 500 }
    );
  }
}
