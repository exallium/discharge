import { NextResponse } from 'next/server';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

import { listTriggers } from '@/src/triggers';
import { settingsRepo } from '@/src/db/repositories';

/**
 * GET /api/triggers
 * List available triggers with their webhook configuration
 */
export async function GET() {
  try {
    const triggers = listTriggers();

    // Get configured base URL from settings or fall back to env
    const baseUrl = await settingsRepo.get('system:base_url')
      || process.env.BASE_URL
      || null;

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
