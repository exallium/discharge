/**
 * Redis Pub/Sub for Real-Time Updates
 *
 * Provides real-time event streaming for conversations using Redis pub/sub.
 * Events are published when jobs start, complete, fail, or messages are added.
 */

import Redis from 'ioredis';
import { logger } from '../logger';

/**
 * Event types that can be published
 */
export type ConversationEventType =
  | 'job_started'
  | 'job_completed'
  | 'job_failed'
  | 'message_added'
  | 'status_changed'
  | 'plan_updated';

/**
 * Event payload structure
 */
export interface ConversationRealtimeEvent {
  type: ConversationEventType;
  conversationId: string;
  timestamp: string;
  data: Record<string, unknown>;
}

/**
 * Get the channel name for a conversation
 */
export function getChannelName(conversationId: string): string {
  return `conversation:${conversationId}`;
}

/**
 * Dedicated publisher connection (lazy-initialized)
 */
let publisherConnection: Redis | null = null;

/**
 * Get or create the publisher connection
 */
function getPublisher(): Redis {
  if (!publisherConnection) {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    publisherConnection = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true,
    });

    publisherConnection.on('error', (err) => {
      logger.error('Redis publisher connection error', { error: err.message });
    });
  }
  return publisherConnection;
}

/**
 * Publish a conversation event
 */
export async function publishConversationEvent(
  conversationId: string,
  event: Omit<ConversationRealtimeEvent, 'conversationId' | 'timestamp'>
): Promise<void> {
  const publisher = getPublisher();
  const channel = getChannelName(conversationId);

  const fullEvent: ConversationRealtimeEvent = {
    ...event,
    conversationId,
    timestamp: new Date().toISOString(),
  };

  try {
    await publisher.publish(channel, JSON.stringify(fullEvent));
    logger.debug('Published conversation event', {
      conversationId,
      type: event.type,
      channel,
    });
  } catch (err) {
    logger.error('Failed to publish conversation event', {
      conversationId,
      type: event.type,
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
}

/**
 * Create a subscriber for a conversation
 *
 * Returns an async generator that yields events as they arrive.
 * Automatically handles connection cleanup when the generator is closed.
 */
export async function* subscribeToConversation(
  conversationId: string,
  signal?: AbortSignal
): AsyncGenerator<ConversationRealtimeEvent> {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  const subscriber = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  const channel = getChannelName(conversationId);
  const messageQueue: ConversationRealtimeEvent[] = [];
  let resolveNext: ((value: ConversationRealtimeEvent | null) => void) | null = null;
  let closed = false;

  // Handle incoming messages
  subscriber.on('message', (_ch, message) => {
    try {
      const event = JSON.parse(message) as ConversationRealtimeEvent;
      if (resolveNext) {
        resolveNext(event);
        resolveNext = null;
      } else {
        messageQueue.push(event);
      }
    } catch {
      logger.warn('Failed to parse pub/sub message', { channel, message });
    }
  });

  // Handle errors
  subscriber.on('error', (err) => {
    logger.error('Subscriber error', { conversationId, error: err.message });
    if (resolveNext) {
      resolveNext(null);
      resolveNext = null;
    }
  });

  // Subscribe to the channel
  await subscriber.subscribe(channel);
  logger.debug('Subscribed to conversation', { conversationId, channel });

  // Handle abort signal
  if (signal) {
    signal.addEventListener('abort', () => {
      closed = true;
      if (resolveNext) {
        resolveNext(null);
        resolveNext = null;
      }
    });
  }

  try {
    while (!closed && (!signal || !signal.aborted)) {
      // Return queued messages first
      if (messageQueue.length > 0) {
        yield messageQueue.shift()!;
        continue;
      }

      // Wait for next message
      const event = await new Promise<ConversationRealtimeEvent | null>((resolve) => {
        resolveNext = resolve;

        // Add a timeout to periodically check for abort
        const timeout = setTimeout(() => {
          if (resolveNext === resolve) {
            resolveNext = null;
            resolve(null);
          }
        }, 30000); // 30 second heartbeat interval

        // Clear timeout if resolved
        const originalResolve = resolve;
        resolveNext = (value) => {
          clearTimeout(timeout);
          originalResolve(value);
        };
      });

      if (event === null) {
        // Timeout or abort - check if we should continue
        if (signal?.aborted) {
          break;
        }
        // Otherwise continue waiting (this was just a heartbeat)
        continue;
      }

      yield event;
    }
  } finally {
    // Cleanup
    closed = true;
    await subscriber.unsubscribe(channel);
    await subscriber.quit();
    logger.debug('Unsubscribed from conversation', { conversationId, channel });
  }
}

/**
 * Graceful shutdown - close all connections
 */
export async function closeRealtimeConnections(): Promise<void> {
  if (publisherConnection) {
    await publisherConnection.quit();
    publisherConnection = null;
    logger.info('Closed realtime publisher connection');
  }
}
