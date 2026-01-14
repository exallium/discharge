import { NextRequest, NextResponse } from 'next/server';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

import { getSession, verifyCredentials } from '@/lib/auth';
import { isTotpEnabled, getTotpSecret, verifyTotpCode, verifyBackupCode } from '@/lib/totp';
import { trustedDevicesRepo } from '@/src/db/repositories';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { username, password, totpCode, backupCode, trustDevice } = body;
    const session = await getSession();

    // Step 1: Password verification (when not pending TOTP)
    if (!session.pendingTotpVerification) {
      if (!username || !password) {
        return NextResponse.json(
          { error: 'Username and password are required' },
          { status: 400 }
        );
      }

      const isValid = await verifyCredentials(username, password);

      if (!isValid) {
        return NextResponse.json(
          { error: 'Invalid credentials' },
          { status: 401 }
        );
      }

      // Check if TOTP is enabled
      const totpEnabled = await isTotpEnabled();

      if (totpEnabled) {
        // Check for trusted device cookie
        const deviceToken = request.cookies.get('trusted_device')?.value;
        if (deviceToken && await trustedDevicesRepo.verify(username, deviceToken)) {
          // Trusted device - skip TOTP
          session.username = username;
          session.isLoggedIn = true;
          session.totpVerified = true;
          session.pendingTotpVerification = false;
          await session.save();
          return NextResponse.json({ success: true });
        }

        // Require TOTP verification
        session.username = username;
        session.pendingTotpVerification = true;
        session.isLoggedIn = false;
        await session.save();
        return NextResponse.json({ requireTotp: true });
      }

      // No TOTP - complete login
      session.username = username;
      session.isLoggedIn = true;
      session.pendingTotpVerification = false;
      await session.save();
      return NextResponse.json({ success: true });
    }

    // Step 2: TOTP verification
    const code = totpCode || backupCode;
    if (!code) {
      return NextResponse.json(
        { error: 'Verification code is required' },
        { status: 400 }
      );
    }

    let valid = false;

    if (totpCode) {
      // Verify TOTP code
      const secret = await getTotpSecret();
      if (secret) {
        valid = verifyTotpCode(secret, totpCode);
      }
    } else if (backupCode) {
      // Verify backup code
      valid = await verifyBackupCode(backupCode);
    }

    if (!valid) {
      return NextResponse.json(
        { error: 'Invalid verification code' },
        { status: 401 }
      );
    }

    // Complete login
    session.pendingTotpVerification = false;
    session.isLoggedIn = true;
    session.totpVerified = true;
    await session.save();

    const response = NextResponse.json({ success: true });

    // Trust device if requested
    if (trustDevice && session.username) {
      const userAgent = request.headers.get('user-agent') ?? undefined;
      const token = await trustedDevicesRepo.create(session.username, userAgent);
      response.cookies.set('trusted_device', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 30 * 24 * 60 * 60, // 30 days
      });
    }

    return response;
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json(
      { error: 'Login failed' },
      { status: 500 }
    );
  }
}
