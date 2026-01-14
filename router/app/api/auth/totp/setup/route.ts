import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

import { getSession } from '@/lib/auth';
import {
  generateTotpSecret,
  verifyTotpCode,
  generateBackupCodes,
  saveTotpSetup,
} from '@/lib/totp';

/**
 * GET /api/auth/totp/setup
 * Start TOTP setup - generate a new secret and QR code
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

    // Generate new TOTP secret
    const { secret, qrDataUrl } = await generateTotpSecret(session.username);

    // Store secret temporarily in session for verification
    session.pendingTotpSecret = secret;
    await session.save();

    return NextResponse.json({ qrDataUrl, secret });
  } catch (error) {
    console.error('TOTP setup error:', error);
    return NextResponse.json(
      { error: 'Failed to start TOTP setup' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/auth/totp/setup
 * Verify TOTP code and complete setup
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

    const { code } = await request.json();

    if (!code) {
      return NextResponse.json(
        { error: 'Verification code is required' },
        { status: 400 }
      );
    }

    const pendingSecret = session.pendingTotpSecret;
    if (!pendingSecret) {
      return NextResponse.json(
        { error: 'No pending TOTP setup. Please start setup again.' },
        { status: 400 }
      );
    }

    // Verify the code against the pending secret
    const valid = verifyTotpCode(pendingSecret, code);
    if (!valid) {
      return NextResponse.json(
        { error: 'Invalid verification code' },
        { status: 400 }
      );
    }

    // Generate backup codes
    const { codes, hashes } = await generateBackupCodes();

    // Save TOTP setup to database
    await saveTotpSetup(pendingSecret, hashes);

    // Clear pending secret from session
    delete session.pendingTotpSecret;
    session.totpVerified = true;
    await session.save();

    return NextResponse.json({
      success: true,
      backupCodes: codes,
    });
  } catch (error) {
    console.error('TOTP setup error:', error);
    return NextResponse.json(
      { error: 'Failed to complete TOTP setup' },
      { status: 500 }
    );
  }
}
