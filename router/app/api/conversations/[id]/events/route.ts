/**
 * Server-Sent Events (SSE) endpoint for real-time conversation updates
 *
 * Streams events from Redis pub/sub to connected clients.
 * Events include: job_started, job_completed, job_failed, message_added, status_changed
 */

import { NextRequest } from 'next/server';
import { subscribeToConversation, ConversationRealtimeEvent } from '@/src/realtime/pubsub';
import { conversationsRepo } from '@/src/db/repositories';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/conversations/[id]/events
 *
 * Opens an SSE connection for real-time updates on a conversation.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: conversationId } = await params;

  // Verify conversation exists
  const conversation = await conversationsRepo.findById(conversationId);
  if (!conversation) {
    return new Response('Conversation not found', { status: 404 });
  }

  // Create abort controller for cleanup
  const abortController = new AbortController();

  // Handle client disconnect
  request.signal.addEventListener('abort', () => {
    abortController.abort();
  });

  // Create the SSE stream
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      // Send initial connection event
      const connectEvent = {
        type: 'connected',
        conversationId,
        timestamp: new Date().toISOString(),
      };
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify(connectEvent)}\n\n`)
      );

      try {
        // Subscribe to Redis pub/sub
        const subscription = subscribeToConversation(
          conversationId,
          abortController.signal
        );

        // Stream events as they arrive
        for await (const event of subscription) {
          if (abortController.signal.aborted) {
            break;
          }

          // Format as SSE
          const sseMessage = formatSSE(event);
          controller.enqueue(encoder.encode(sseMessage));
        }
      } catch (error) {
        // Only log if not an abort
        if (!abortController.signal.aborted) {
          console.error('SSE stream error:', error);
        }
      } finally {
        controller.close();
      }
    },
    cancel() {
      // Client disconnected
      abortController.abort();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    },
  });
}

/**
 * Format an event as SSE
 */
function formatSSE(event: ConversationRealtimeEvent): string {
  // Use event type as the SSE event name
  const eventLine = `event: ${event.type}\n`;
  const dataLine = `data: ${JSON.stringify(event)}\n`;
  return `${eventLine}${dataLine}\n`;
}
