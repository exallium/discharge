import { NextResponse } from 'next/server';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

import { listTriggerIds } from '@/src/triggers';

/**
 * GET /api/webhooks
 * List all available webhook endpoints
 */
export async function GET() {
  const endpoints = listTriggerIds().map(id => ({
    id,
    url: `/api/webhooks/${id}`,
    method: 'POST',
  }));

  return NextResponse.json({
    message: 'Discharge Webhook Router',
    endpoints,
  });
}
