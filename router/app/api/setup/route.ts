import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcrypt';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

import { settingsRepo } from '@/src/db/repositories';
import { getSession, isSetupRequired } from '@/lib/auth';
import { clearGeneratedPassword } from '@/lib/startup';

/**
 * POST /api/setup
 * Set admin credentials (only works if no DB password is set)
 */
export async function POST(request: NextRequest) {
  try {
    // Verify user is logged in
    const session = await getSession();
    if (!session.isLoggedIn) {
      return NextResponse.json(
        { error: 'Must be logged in to complete setup' },
        { status: 401 }
      );
    }

    // Check if setup is still needed
    const setupRequired = await isSetupRequired();
    if (!setupRequired) {
      return NextResponse.json(
        { error: 'Setup already completed' },
        { status: 400 }
      );
    }

    const { username, password } = await request.json();

    if (!username || !password) {
      return NextResponse.json(
        { error: 'Username and password are required' },
        { status: 400 }
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters' },
        { status: 400 }
      );
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Store credentials in database
    await settingsRepo.set('admin:username', username);
    await settingsRepo.set('admin:password', hashedPassword);

    // Clear the generated password
    clearGeneratedPassword();

    // Update session with new username
    session.username = username;
    await session.save();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Setup error:', error);
    return NextResponse.json(
      { error: 'Setup failed' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/setup
 * Check if setup is required
 */
export async function GET() {
  try {
    const setupRequired = await isSetupRequired();
    return NextResponse.json({ setupRequired });
  } catch (error) {
    console.error('Setup check error:', error);
    return NextResponse.json(
      { error: 'Failed to check setup status' },
      { status: 500 }
    );
  }
}
