/**
 * Trusted devices repository - CRUD operations for TOTP device trust
 *
 * Manages trusted devices that can skip TOTP verification for 30 days.
 */

import { eq, and, gt, lt } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import { getDatabase, trustedDevices, TrustedDevice } from '../index';
import { logger } from '../../logger';

const TRUST_DURATION_DAYS = 30;

/**
 * Trusted device entry
 */
export interface TrustedDeviceEntry {
  id: string;
  username: string;
  deviceToken: string;
  userAgent: string | null;
  lastUsedAt: Date;
  createdAt: Date;
  expiresAt: Date;
}

/**
 * Convert database row to entry
 */
function toEntry(row: TrustedDevice): TrustedDeviceEntry {
  return {
    id: row.id,
    username: row.username,
    deviceToken: row.deviceToken,
    userAgent: row.userAgent,
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  };
}

/**
 * Create a new trusted device and return the token
 */
export async function create(
  username: string,
  userAgent?: string
): Promise<string> {
  const db = getDatabase();
  const deviceToken = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + TRUST_DURATION_DAYS * 24 * 60 * 60 * 1000);

  await db.insert(trustedDevices).values({
    username,
    deviceToken,
    userAgent: userAgent ?? null,
    expiresAt,
  });

  logger.info('Trusted device created', { username });
  return deviceToken;
}

/**
 * Verify a trusted device token and update last used timestamp
 * Returns true if the device is valid and not expired
 */
export async function verify(
  username: string,
  token: string
): Promise<boolean> {
  const db = getDatabase();

  const result = await db
    .select()
    .from(trustedDevices)
    .where(
      and(
        eq(trustedDevices.username, username),
        eq(trustedDevices.deviceToken, token),
        gt(trustedDevices.expiresAt, new Date())
      )
    )
    .limit(1);

  if (result.length === 0) {
    return false;
  }

  // Update last used timestamp
  await db
    .update(trustedDevices)
    .set({ lastUsedAt: new Date() })
    .where(eq(trustedDevices.id, result[0].id));

  logger.debug('Trusted device verified', { username });
  return true;
}

/**
 * Get all trusted devices for a user
 */
export async function findByUsername(username: string): Promise<TrustedDeviceEntry[]> {
  const db = getDatabase();

  const result = await db
    .select()
    .from(trustedDevices)
    .where(eq(trustedDevices.username, username));

  return result.map(toEntry);
}

/**
 * Revoke a specific trusted device by token
 */
export async function revoke(token: string): Promise<boolean> {
  const db = getDatabase();

  const result = await db
    .delete(trustedDevices)
    .where(eq(trustedDevices.deviceToken, token))
    .returning({ id: trustedDevices.id });

  if (result.length > 0) {
    logger.info('Trusted device revoked', { token: token.substring(0, 8) + '...' });
    return true;
  }

  return false;
}

/**
 * Revoke all trusted devices for a user
 */
export async function revokeAll(username: string): Promise<number> {
  const db = getDatabase();

  const result = await db
    .delete(trustedDevices)
    .where(eq(trustedDevices.username, username))
    .returning({ id: trustedDevices.id });

  if (result.length > 0) {
    logger.info('All trusted devices revoked', { username, count: result.length });
  }

  return result.length;
}

/**
 * Clean up expired devices
 */
export async function cleanupExpired(): Promise<number> {
  const db = getDatabase();

  const result = await db
    .delete(trustedDevices)
    .where(lt(trustedDevices.expiresAt, new Date()))
    .returning({ id: trustedDevices.id });

  if (result.length > 0) {
    logger.info('Expired trusted devices cleaned up', { count: result.length });
  }

  return result.length;
}
