import { cookies } from 'next/headers';
import { getIronSession, SessionOptions } from 'iron-session';
import { settingsRepo } from '@/src/db/repositories';
import { getGeneratedPassword, logGeneratedPassword } from './startup';

export interface SessionData {
  username: string;
  isLoggedIn: boolean;
}

const sessionOptions: SessionOptions = {
  password: process.env.SESSION_SECRET || 'complex_password_at_least_32_characters_long',
  cookieName: 'ai-bug-fixer-session',
  cookieOptions: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7, // 1 week
  },
};

export async function getSession() {
  const cookieStore = await cookies();
  const session = await getIronSession<SessionData>(cookieStore, sessionOptions);
  return session;
}

export async function verifyCredentials(username: string, password: string): Promise<boolean> {
  // Check against stored credentials in database (highest priority)
  const storedUsername = await settingsRepo.get('admin:username');
  const storedPassword = await settingsRepo.get('admin:password');

  if (storedUsername && storedPassword) {
    // Use bcrypt to verify password
    const bcrypt = await import('bcrypt');
    if (username === storedUsername) {
      return bcrypt.compare(password, storedPassword);
    }
    return false;
  }

  // Fallback to environment variables
  const envUsername = process.env.ADMIN_USERNAME || 'admin';
  const envPassword = process.env.ADMIN_PASSWORD;

  if (envPassword) {
    return username === envUsername && password === envPassword;
  }

  // Final fallback: generated password for first-run
  // Log it to console so user can see it
  logGeneratedPassword();
  const generatedPwd = getGeneratedPassword();
  return username === 'admin' && password === generatedPwd;
}

/**
 * Check if setup is required (no permanent DB password configured)
 * Even if ADMIN_PASSWORD env var is set, we still require setup
 * to set a permanent hashed password in the database.
 */
export async function isSetupRequired(): Promise<boolean> {
  const dbPassword = await settingsRepo.get('admin:password');
  return !dbPassword;
}

/**
 * Check if this is a first-run scenario (no password anywhere)
 * Used to show "check console for password" message on login page
 */
export async function isFirstRun(): Promise<boolean> {
  const dbPassword = await settingsRepo.get('admin:password');
  const envPassword = process.env.ADMIN_PASSWORD;
  return !dbPassword && !envPassword;
}
