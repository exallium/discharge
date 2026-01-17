import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcrypt';

export const dynamic = 'force-dynamic';

import { getSession, verifyCredentials } from '@/lib/auth';
import { settingsRepo } from '@/src/db/repositories';

/**
 * POST /api/auth/password
 * Change admin password
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();

    if (!session.isLoggedIn) {
      return NextResponse.json(
        { error: 'Must be logged in to change password' },
        { status: 401 }
      );
    }

    const { currentPassword, newPassword } = await request.json();

    if (!currentPassword || !newPassword) {
      return NextResponse.json(
        { error: 'Current and new passwords are required' },
        { status: 400 }
      );
    }

    if (newPassword.length < 8) {
      return NextResponse.json(
        { error: 'New password must be at least 8 characters' },
        { status: 400 }
      );
    }

    // Verify current password
    const isValid = await verifyCredentials(session.username, currentPassword);
    if (!isValid) {
      return NextResponse.json(
        { error: 'Current password is incorrect' },
        { status: 401 }
      );
    }

    // Hash and store new password
    const hashedPassword = await bcrypt.hash(newPassword, 12);
    await settingsRepo.set('admin:password', hashedPassword, {
      description: 'Admin UI password hash',
      category: 'auth',
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Password change error:', error);
    return NextResponse.json(
      { error: 'Failed to change password' },
      { status: 500 }
    );
  }
}
