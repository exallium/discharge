import { NextRequest, NextResponse } from 'next/server';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

import { getTriggerById, listTriggerIds } from '@/src/triggers';
import { queueFixJob } from '@/src/queue';
import { getEventRouter } from '@/src/conversation/router';
import type { WebhookRequest } from '@/src/triggers/base';

interface RouteParams {
  params: Promise<{ triggerId: string }>;
}

/**
 * Adapter to convert Next.js request to WebhookRequest
 */
function createWebhookRequest(req: NextRequest, body: unknown): WebhookRequest {
  return {
    headers: req.headers,
    body,
  };
}

/**
 * POST /api/webhooks/[triggerId]
 * Generic webhook endpoint - each trigger plugin handles its own validation and parsing
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { triggerId } = await params;
  const trigger = getTriggerById(triggerId);

  // Check if trigger exists
  if (!trigger) {
    return NextResponse.json(
      {
        error: 'Unknown trigger',
        available: listTriggerIds(),
      },
      { status: 404 }
    );
  }

  try {
    // Parse request body
    const body = await request.json();

    // Create WebhookRequest adapter
    const webhookReq = createWebhookRequest(request, body);

    // Validate webhook signature/authentication
    const isValid = await trigger.validateWebhook(webhookReq);
    if (!isValid) {
      return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 401 });
    }

    // Parse webhook payload into normalized event
    const event = await trigger.parseWebhook(body);
    if (!event) {
      return NextResponse.json({
        ignored: true,
        reason: 'Event filtered by trigger plugin',
      });
    }

    // Optional pre-processing filter
    if (trigger.shouldProcess) {
      const shouldProcess = await trigger.shouldProcess(event);
      if (!shouldProcess) {
        return NextResponse.json({
          ignored: true,
          reason: 'Event filtered by shouldProcess',
        });
      }
    }

    // Check if trigger supports conversation mode
    if (trigger.supportsConversation && trigger.parseConversationEvent) {
      // Try to route through conversation system
      const conversationEvent = await trigger.parseConversationEvent(body);

      if (conversationEvent) {
        // Route through EventRouter
        const eventRouter = getEventRouter();
        const routeResult = await eventRouter.routeEvent(
          trigger,
          conversationEvent,
          event
        );

        return NextResponse.json(
          {
            queued: routeResult.action === 'started_job' || routeResult.action === 'queued_event',
            action: routeResult.action,
            conversationId: routeResult.conversationId,
            jobId: routeResult.jobId,
            reason: routeResult.reason,
            triggerType: event.triggerType,
            triggerId: event.triggerId,
            projectId: event.projectId,
          },
          { status: 202 }
        );
      }
      // If parseConversationEvent returns null, fall through to regular flow
    }

    // Queue the job (legacy flow for non-conversation triggers)
    const jobId = await queueFixJob({
      event,
      triggerType: trigger.type,
      queuedAt: new Date().toISOString(),
    });

    return NextResponse.json(
      {
        queued: true,
        jobId,
        triggerType: event.triggerType,
        triggerId: event.triggerId,
        projectId: event.projectId,
      },
      { status: 202 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[${triggerId}] Webhook error:`, error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * GET /api/webhooks/[triggerId]
 * Info about a specific webhook endpoint
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { triggerId } = await params;
  const trigger = getTriggerById(triggerId);

  if (!trigger) {
    return NextResponse.json(
      {
        error: 'Unknown trigger',
        available: listTriggerIds(),
      },
      { status: 404 }
    );
  }

  return NextResponse.json({
    id: trigger.id,
    type: trigger.type,
    supportsConversation: trigger.supportsConversation || false,
    method: 'POST',
  });
}
