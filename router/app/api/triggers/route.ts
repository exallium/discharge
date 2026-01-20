import { NextRequest, NextResponse } from 'next/server';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

import { listTriggers } from '@/src/triggers';

/**
 * GET /api/triggers
 * List available triggers with their webhook configuration
 */
export async function GET(request: NextRequest) {
  try {
    const triggers = listTriggers();

    // Derive base URL from request headers
    const host = request.headers.get('host') || 'localhost:3000';
    const protocol = request.headers.get('x-forwarded-proto') || 'http';
    const baseUrl = `${protocol}://${host}`;

    const triggerInfo = triggers.map((trigger) => ({
      id: trigger.id,
      type: trigger.type,
      webhookPath: `/api/webhooks/${trigger.id}`,
      webhookConfig: trigger.webhookConfig,
    }));

    return NextResponse.json({
      baseUrl,
      triggers: triggerInfo,
    });
  } catch (error) {
    console.error('Failed to list triggers:', error);
    return NextResponse.json(
      { error: 'Failed to list triggers' },
      { status: 500 }
    );
  }
}
