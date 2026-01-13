/**
 * Conversations repository - CRUD operations for conversation state management
 */

import { eq, and, isNull, desc, sql } from 'drizzle-orm';
import {
  getDatabase,
  conversations,
  conversationMessages,
  pendingEvents,
  Conversation,
  NewConversation,
  ConversationMessage,
  NewConversationMessage,
  PendingEvent,
  NewPendingEvent,
} from '../index';
import { logger } from '../../logger';
import type {
  ConversationState,
  RouteMode,
  WorkflowStatus,
  ConfidenceAssessment,
  ConversationEvent,
} from '../../types/conversation';

/**
 * Conversation entry with computed fields
 */
export interface ConversationEntry {
  id: string;
  triggerType: string;
  externalId: string;
  projectId: string;
  state: ConversationState;
  currentJobId: string | null;
  routeMode: RouteMode;
  status: WorkflowStatus;
  iteration: number;
  planRef: string | null;
  planVersion: number | null;
  confidence: ConfidenceAssessment | null;
  triggerEvent: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
  lastActivityAt: Date;
}

/**
 * Message entry
 */
export interface MessageEntry {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  sourceType: string | null;
  sourceId: string | null;
  sourceAuthor: string | null;
  createdAt: Date;
}

/**
 * Pending event entry
 */
export interface PendingEventEntry {
  id: string;
  conversationId: string;
  eventType: string;
  eventPayload: ConversationEvent;
  queuedAt: Date;
  processedAt: Date | null;
}

/**
 * Convert database row to ConversationEntry
 */
function toConversationEntry(row: Conversation): ConversationEntry {
  return {
    id: row.id,
    triggerType: row.triggerType,
    externalId: row.externalId,
    projectId: row.projectId,
    state: row.state as ConversationState,
    currentJobId: row.currentJobId,
    routeMode: row.routeMode as RouteMode,
    status: row.status as WorkflowStatus,
    iteration: row.iteration,
    planRef: row.planRef,
    planVersion: row.planVersion,
    confidence: row.confidence as ConfidenceAssessment | null,
    triggerEvent: row.triggerEvent as Record<string, unknown> | null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastActivityAt: row.lastActivityAt,
  };
}

/**
 * Convert database row to MessageEntry
 */
function toMessageEntry(row: ConversationMessage): MessageEntry {
  return {
    id: row.id,
    conversationId: row.conversationId,
    role: row.role as 'user' | 'assistant' | 'system',
    content: row.content,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    sourceAuthor: row.sourceAuthor,
    createdAt: row.createdAt,
  };
}

/**
 * Convert database row to PendingEventEntry
 */
function toPendingEventEntry(row: PendingEvent): PendingEventEntry {
  return {
    id: row.id,
    conversationId: row.conversationId,
    eventType: row.eventType,
    eventPayload: row.eventPayload as ConversationEvent,
    queuedAt: row.queuedAt,
    processedAt: row.processedAt,
  };
}

// ==================== CONVERSATION OPERATIONS ====================

/**
 * Find a conversation by ID
 */
export async function findById(id: string): Promise<ConversationEntry | undefined> {
  const db = getDatabase();
  const result = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, id))
    .limit(1);

  return result[0] ? toConversationEntry(result[0]) : undefined;
}

/**
 * Find a conversation by trigger type and external ID
 */
export async function findByTarget(
  triggerType: string,
  externalId: string
): Promise<ConversationEntry | undefined> {
  const db = getDatabase();
  const result = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.triggerType, triggerType),
        eq(conversations.externalId, externalId)
      )
    )
    .limit(1);

  return result[0] ? toConversationEntry(result[0]) : undefined;
}

/**
 * Get or create a conversation for a target
 */
export async function getOrCreate(
  triggerType: string,
  externalId: string,
  projectId: string,
  triggerEvent?: Record<string, unknown>
): Promise<ConversationEntry> {
  const existing = await findByTarget(triggerType, externalId);
  if (existing) {
    return existing;
  }

  const db = getDatabase();
  const newConversation: NewConversation = {
    triggerType,
    externalId,
    projectId,
    state: 'idle',
    routeMode: 'plan_review',
    status: 'pending',
    iteration: 0,
    triggerEvent: triggerEvent ?? null,
  };

  const result = await db.insert(conversations).values(newConversation).returning();

  logger.info('Conversation created', {
    conversationId: result[0].id,
    triggerType,
    externalId,
    projectId,
  });

  return toConversationEntry(result[0]);
}

/**
 * Attempt to acquire lock on a conversation (IDLE -> RUNNING transition)
 * Returns true if lock acquired, false if already running
 */
export async function acquireLock(conversationId: string, jobId: string): Promise<boolean> {
  const db = getDatabase();

  const result = await db
    .update(conversations)
    .set({
      state: 'running',
      currentJobId: jobId,
      updatedAt: new Date(),
      lastActivityAt: new Date(),
    })
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.state, 'idle')
      )
    )
    .returning({ id: conversations.id });

  if (result.length > 0) {
    logger.debug('Lock acquired', { conversationId, jobId });
    return true;
  }

  logger.debug('Lock not acquired (conversation not idle)', { conversationId });
  return false;
}

/**
 * Release lock on a conversation (RUNNING -> IDLE transition)
 * Only releases if the current job ID matches
 */
export async function releaseLock(conversationId: string, jobId?: string): Promise<boolean> {
  const db = getDatabase();

  const conditions = [eq(conversations.id, conversationId)];
  if (jobId) {
    conditions.push(eq(conversations.currentJobId, jobId));
  }

  const result = await db
    .update(conversations)
    .set({
      state: 'idle',
      currentJobId: null,
      updatedAt: new Date(),
    })
    .where(and(...conditions))
    .returning({ id: conversations.id });

  if (result.length > 0) {
    logger.debug('Lock released', { conversationId, jobId });
    return true;
  }

  return false;
}

/**
 * Update conversation status and fields
 */
export async function update(
  id: string,
  updates: Partial<{
    state: ConversationState;
    currentJobId: string | null;
    routeMode: RouteMode;
    status: WorkflowStatus;
    iteration: number;
    planRef: string;
    planVersion: number;
    confidence: ConfidenceAssessment;
    triggerEvent: Record<string, unknown>;
  }>
): Promise<ConversationEntry | undefined> {
  const db = getDatabase();

  const updateData: Partial<NewConversation> = {
    ...updates,
    updatedAt: new Date(),
    lastActivityAt: new Date(),
  };

  const result = await db
    .update(conversations)
    .set(updateData)
    .where(eq(conversations.id, id))
    .returning();

  if (result[0]) {
    logger.debug('Conversation updated', { conversationId: id, updates: Object.keys(updates) });
    return toConversationEntry(result[0]);
  }

  return undefined;
}

/**
 * Increment iteration counter
 */
export async function incrementIteration(id: string): Promise<number> {
  const db = getDatabase();

  const result = await db
    .update(conversations)
    .set({
      iteration: sql`${conversations.iteration} + 1`,
      updatedAt: new Date(),
      lastActivityAt: new Date(),
    })
    .where(eq(conversations.id, id))
    .returning({ iteration: conversations.iteration });

  return result[0]?.iteration ?? 0;
}

/**
 * Find conversations by project ID
 */
export async function findByProject(projectId: string): Promise<ConversationEntry[]> {
  const db = getDatabase();
  const result = await db
    .select()
    .from(conversations)
    .where(eq(conversations.projectId, projectId))
    .orderBy(desc(conversations.lastActivityAt));

  return result.map(toConversationEntry);
}

/**
 * Find active (non-idle) conversations
 */
export async function findActive(): Promise<ConversationEntry[]> {
  const db = getDatabase();
  const result = await db
    .select()
    .from(conversations)
    .where(sql`${conversations.state} != 'idle'`)
    .orderBy(desc(conversations.lastActivityAt));

  return result.map(toConversationEntry);
}

// ==================== MESSAGE OPERATIONS ====================

/**
 * Add a message to a conversation
 */
export async function addMessage(
  conversationId: string,
  role: 'user' | 'assistant' | 'system',
  content: string,
  source?: { type: string; id: string; author: string }
): Promise<MessageEntry> {
  const db = getDatabase();

  const newMessage: NewConversationMessage = {
    conversationId,
    role,
    content,
    sourceType: source?.type ?? null,
    sourceId: source?.id ?? null,
    sourceAuthor: source?.author ?? null,
  };

  const result = await db.insert(conversationMessages).values(newMessage).returning();

  // Update conversation activity timestamp
  await db
    .update(conversations)
    .set({ lastActivityAt: new Date() })
    .where(eq(conversations.id, conversationId));

  return toMessageEntry(result[0]);
}

/**
 * Get message history for a conversation
 */
export async function getMessages(
  conversationId: string,
  limit?: number
): Promise<MessageEntry[]> {
  const db = getDatabase();

  let query = db
    .select()
    .from(conversationMessages)
    .where(eq(conversationMessages.conversationId, conversationId))
    .orderBy(conversationMessages.createdAt);

  if (limit) {
    query = query.limit(limit) as typeof query;
  }

  const result = await query;
  return result.map(toMessageEntry);
}

/**
 * Count messages in a conversation
 */
export async function countMessages(conversationId: string): Promise<number> {
  const db = getDatabase();
  const result = await db
    .select()
    .from(conversationMessages)
    .where(eq(conversationMessages.conversationId, conversationId));

  return result.length;
}

// ==================== PENDING EVENTS OPERATIONS ====================

/**
 * Queue an event for a conversation
 */
export async function queueEvent(
  conversationId: string,
  eventType: string,
  eventPayload: ConversationEvent
): Promise<PendingEventEntry> {
  const db = getDatabase();

  const newEvent: NewPendingEvent = {
    conversationId,
    eventType,
    eventPayload,
  };

  const result = await db.insert(pendingEvents).values(newEvent).returning();

  logger.debug('Event queued', { conversationId, eventType });

  return toPendingEventEntry(result[0]);
}

/**
 * Get unprocessed events for a conversation
 */
export async function getPendingEvents(conversationId: string): Promise<PendingEventEntry[]> {
  const db = getDatabase();

  const result = await db
    .select()
    .from(pendingEvents)
    .where(
      and(
        eq(pendingEvents.conversationId, conversationId),
        isNull(pendingEvents.processedAt)
      )
    )
    .orderBy(pendingEvents.queuedAt);

  return result.map(toPendingEventEntry);
}

/**
 * Drain pending events (get and mark as processed atomically)
 * Returns the events that were drained
 */
export async function drainEvents(conversationId: string): Promise<PendingEventEntry[]> {
  const db = getDatabase();

  // Get unprocessed events
  const events = await getPendingEvents(conversationId);

  if (events.length === 0) {
    return [];
  }

  // Mark them as processed
  const eventIds = events.map((e) => e.id);
  await db
    .update(pendingEvents)
    .set({ processedAt: new Date() })
    .where(
      and(
        eq(pendingEvents.conversationId, conversationId),
        isNull(pendingEvents.processedAt)
      )
    );

  logger.debug('Events drained', { conversationId, count: events.length });

  return events;
}

/**
 * Count pending events for a conversation
 */
export async function countPendingEvents(conversationId: string): Promise<number> {
  const db = getDatabase();

  const result = await db
    .select()
    .from(pendingEvents)
    .where(
      and(
        eq(pendingEvents.conversationId, conversationId),
        isNull(pendingEvents.processedAt)
      )
    );

  return result.length;
}

// ==================== CLEANUP OPERATIONS ====================

/**
 * Delete old conversations (older than TTL days)
 */
export async function cleanupOldConversations(ttlDays: number): Promise<number> {
  const db = getDatabase();

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - ttlDays);

  const result = await db
    .delete(conversations)
    .where(sql`${conversations.lastActivityAt} < ${cutoffDate}`)
    .returning({ id: conversations.id });

  if (result.length > 0) {
    logger.info('Cleaned up old conversations', { count: result.length, ttlDays });
  }

  return result.length;
}

/**
 * Delete processed events older than a certain age
 */
export async function cleanupProcessedEvents(olderThanDays: number): Promise<number> {
  const db = getDatabase();

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

  const result = await db
    .delete(pendingEvents)
    .where(
      and(
        sql`${pendingEvents.processedAt} IS NOT NULL`,
        sql`${pendingEvents.processedAt} < ${cutoffDate}`
      )
    )
    .returning({ id: pendingEvents.id });

  if (result.length > 0) {
    logger.debug('Cleaned up old processed events', { count: result.length });
  }

  return result.length;
}
