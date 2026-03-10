/**
 * API Token Management
 *
 * POST   /api/settings/api-tokens - Generate a new API token
 * GET    /api/settings/api-tokens - List tokens (hashed, not raw)
 * DELETE /api/settings/api-tokens - Revoke a token by key
 *
 * These endpoints require session auth (admin), not API token auth.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDatabase, settings } from '@/src/db';
import { eq, and } from 'drizzle-orm';
import { generateApiToken } from '@/src/middleware/api-token';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

async function requireSession(): Promise<NextResponse | null> {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}

export async function POST(request: NextRequest) {
  const authError = await requireSession();
  if (authError) return authError;

  try {
    const body = await request.json().catch(() => ({}));
    const label = (body as { label?: string }).label || 'CLI Token';

    const { token, hash } = generateApiToken();
    const key = `api_token_${hash.slice(0, 12)}`;

    const db = getDatabase();
    await db.insert(settings).values({
      key,
      value: hash,
      encrypted: false,
      description: label,
      category: 'api_token',
    });

    return NextResponse.json(
      {
        key,
        token, // Show raw token only once
        label,
        prefix: token.slice(0, 12) + '...',
        createdAt: new Date().toISOString(),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Failed to generate API token:', error);
    return NextResponse.json(
      { error: 'Failed to generate token' },
      { status: 500 }
    );
  }
}

export async function GET(_request: NextRequest) {
  const authError = await requireSession();
  if (authError) return authError;

  try {
    const db = getDatabase();
    const tokens = await db
      .select({
        key: settings.key,
        description: settings.description,
        createdAt: settings.createdAt,
      })
      .from(settings)
      .where(eq(settings.category, 'api_token'));

    return NextResponse.json({
      tokens: tokens.map((t) => ({
        key: t.key,
        label: t.description,
        createdAt: t.createdAt,
      })),
    });
  } catch (error) {
    console.error('Failed to list API tokens:', error);
    return NextResponse.json(
      { error: 'Failed to list tokens' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const authError = await requireSession();
  if (authError) return authError;

  try {
    const body = await request.json();
    const { key } = body as { key?: string };

    if (!key) {
      return NextResponse.json(
        { error: 'Missing required field: key' },
        { status: 400 }
      );
    }

    const db = getDatabase();
    const result = await db
      .delete(settings)
      .where(
        and(
          eq(settings.key, key),
          eq(settings.category, 'api_token')
        )
      )
      .returning({ key: settings.key });

    if (result.length === 0) {
      return NextResponse.json(
        { error: 'Token not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ deleted: true, key });
  } catch (error) {
    console.error('Failed to revoke API token:', error);
    return NextResponse.json(
      { error: 'Failed to revoke token' },
      { status: 500 }
    );
  }
}
