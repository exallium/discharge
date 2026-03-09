/**
 * API Token Authentication Middleware
 *
 * Validates Bearer token from Authorization header against hashed tokens
 * stored in the settings table (category: 'api_token').
 */

import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomBytes } from 'crypto';
import { getDatabase, settings } from '../db';
import { eq, and } from 'drizzle-orm';

/**
 * Hash a token for storage/comparison
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Generate a new API token
 * Returns the raw token (show once) and the hash (store in DB)
 */
export function generateApiToken(): { token: string; hash: string } {
  const token = `dsk_${randomBytes(32).toString('hex')}`;
  const hash = hashToken(token);
  return { token, hash };
}

/**
 * Validate a Bearer token from the request
 * Returns null if valid, or an error response if invalid
 */
export async function validateApiToken(
  request: NextRequest
): Promise<NextResponse | null> {
  const authHeader = request.headers.get('authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return NextResponse.json(
      { error: 'Missing or invalid Authorization header. Use: Bearer <token>' },
      { status: 401 }
    );
  }

  const token = authHeader.slice(7); // Remove 'Bearer '
  if (!token) {
    return NextResponse.json(
      { error: 'Empty token' },
      { status: 401 }
    );
  }

  const tokenHash = hashToken(token);

  try {
    const db = getDatabase();
    const results = await db
      .select()
      .from(settings)
      .where(
        and(
          eq(settings.category, 'api_token'),
          eq(settings.value, tokenHash)
        )
      )
      .limit(1);

    if (results.length === 0) {
      return NextResponse.json(
        { error: 'Invalid API token' },
        { status: 401 }
      );
    }

    // Token is valid
    return null;
  } catch (error) {
    console.error('API token validation error:', error);
    return NextResponse.json(
      { error: 'Authentication error' },
      { status: 500 }
    );
  }
}
