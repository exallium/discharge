/**
 * Conversation Service
 *
 * Core service managing conversation state for the feedback loop system.
 * Plugin-agnostic - works with any trigger/runner/VCS combination.
 */

import { conversationsRepo } from '../db/repositories';
import type {
  ConversationEntry,
  MessageEntry,
  PendingEventEntry,
} from '../db/repositories/conversations';
import type {
  RouteMode,
  WorkflowStatus,
  ConfidenceAssessment,
  ConversationEvent,
  ConversationConfig,
  ConversationMessage,
} from '../types/conversation';
import { logger } from '../logger';

export { ConversationEntry, MessageEntry, PendingEventEntry };

/**
 * Route result from the state machine
 */
export interface RouteResult {
  action: 'start_job' | 'queue_event' | 'ignored';
  conversationId?: string;
  reason?: string;
}

/**
 * Lock result from attempting to acquire a conversation lock
 */
export interface LockResult {
  acquired: boolean;
  conversationId: string;
  pendingEvents?: PendingEventEntry[];
}

/**
 * Conversation Service
 *
 * Manages:
 * - Conversation lifecycle (create, update, delete)
 * - State machine (IDLE -> RUNNING -> DRAINING)
 * - Event queuing during active jobs
 * - Message history for AI context
 */
export class ConversationService {
  private config: ConversationConfig;

  constructor(config?: Partial<ConversationConfig>) {
    this.config = {
      enabled: config?.enabled ?? true,
      autoExecuteThreshold: config?.autoExecuteThreshold ?? 0.85,
      planDirectory: config?.planDirectory ?? '.ai-bug-fixer/plans',
      maxIterations: config?.maxIterations ?? 20,
      routingTags: config?.routingTags ?? {
        plan: 'ai:plan',
        auto: 'ai:auto',
        assist: 'ai:assist',
      },
    };
  }

  /**
   * Get or create a conversation for a trigger target
   */
  async getOrCreateConversation(
    triggerType: string,
    externalId: string,
    projectId: string,
    triggerEvent?: Record<string, unknown>
  ): Promise<ConversationEntry> {
    return conversationsRepo.getOrCreate(
      triggerType,
      externalId,
      projectId,
      triggerEvent
    );
  }

  /**
   * Find a conversation by trigger type and external ID
   */
  async findConversation(
    triggerType: string,
    externalId: string
  ): Promise<ConversationEntry | undefined> {
    return conversationsRepo.findByTarget(triggerType, externalId);
  }

  /**
   * Find a conversation by ID
   */
  async getConversation(id: string): Promise<ConversationEntry | undefined> {
    return conversationsRepo.findById(id);
  }

  /**
   * Attempt to acquire lock and start a job
   * Returns true if lock was acquired, false if conversation is already running
   */
  async acquireLock(conversationId: string, jobId: string): Promise<boolean> {
    return conversationsRepo.acquireLock(conversationId, jobId);
  }

  /**
   * Release lock and drain pending events
   * Returns pending events that accumulated during the job
   */
  async releaseLockAndDrain(conversationId: string, jobId?: string): Promise<{
    released: boolean;
    pendingEvents: PendingEventEntry[];
  }> {
    // First drain events (atomically)
    const pendingEvents = await conversationsRepo.drainEvents(conversationId);

    // Then release lock
    const released = await conversationsRepo.releaseLock(conversationId, jobId);

    if (pendingEvents.length > 0) {
      logger.info('Drained pending events', {
        conversationId,
        count: pendingEvents.length,
      });
    }

    return { released, pendingEvents };
  }

  /**
   * Queue an event for a conversation that's currently running
   */
  async queueEvent(
    conversationId: string,
    eventType: string,
    event: ConversationEvent
  ): Promise<PendingEventEntry> {
    return conversationsRepo.queueEvent(conversationId, eventType, event);
  }

  /**
   * Check if a conversation has pending events
   */
  async hasPendingEvents(conversationId: string): Promise<boolean> {
    const count = await conversationsRepo.countPendingEvents(conversationId);
    return count > 0;
  }

  /**
   * Update conversation status
   */
  async updateStatus(
    conversationId: string,
    updates: {
      status?: WorkflowStatus;
      routeMode?: RouteMode;
      planRef?: string;
      planVersion?: number;
      confidence?: ConfidenceAssessment;
    }
  ): Promise<ConversationEntry | undefined> {
    return conversationsRepo.update(conversationId, updates);
  }

  /**
   * Increment iteration counter
   */
  async incrementIteration(conversationId: string): Promise<number> {
    return conversationsRepo.incrementIteration(conversationId);
  }

  /**
   * Add a message to conversation history
   */
  async addMessage(
    conversationId: string,
    role: 'user' | 'assistant' | 'system',
    content: string,
    source?: { type: string; id: string; author: string }
  ): Promise<MessageEntry> {
    return conversationsRepo.addMessage(conversationId, role, content, source);
  }

  /**
   * Get conversation message history for AI context
   */
  async getMessageHistory(
    conversationId: string,
    limit?: number
  ): Promise<ConversationMessage[]> {
    const messages = await conversationsRepo.getMessages(conversationId, limit);
    return messages.map((m) => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content,
      timestamp: m.createdAt.toISOString(),
      sourceType: m.sourceType ?? undefined,
      sourceId: m.sourceId ?? undefined,
      sourceAuthor: m.sourceAuthor ?? undefined,
    }));
  }

  /**
   * Determine route mode from tags
   */
  determineRouteMode(tags: string[]): RouteMode {
    const routingTags = this.config.routingTags!;

    if (tags.includes(routingTags.assist!)) {
      return 'assist_only';
    }
    if (tags.includes(routingTags.plan!)) {
      return 'plan_review';
    }
    if (tags.includes(routingTags.auto!)) {
      return 'auto_execute';
    }

    // Default: will be determined by confidence after analysis
    return 'plan_review';
  }

  /**
   * Check if the maximum iteration count has been reached
   */
  isMaxIterationsReached(conversation: ConversationEntry): boolean {
    return conversation.iteration >= (this.config.maxIterations ?? 20);
  }

  /**
   * Get the plan directory for a project
   */
  getPlanDirectory(): string {
    return this.config.planDirectory ?? '.ai-bug-fixer/plans';
  }

  /**
   * Get the auto-execute threshold
   */
  getAutoExecuteThreshold(): number {
    return this.config.autoExecuteThreshold ?? 0.85;
  }

  /**
   * Cleanup old conversations
   */
  async cleanup(ttlDays?: number): Promise<number> {
    const ttl = ttlDays ?? 30;
    return conversationsRepo.cleanupOldConversations(ttl);
  }

  /**
   * Get active conversations
   */
  async getActiveConversations(): Promise<ConversationEntry[]> {
    return conversationsRepo.findActive();
  }

  /**
   * Get conversations for a project
   */
  async getProjectConversations(projectId: string): Promise<ConversationEntry[]> {
    return conversationsRepo.findByProject(projectId);
  }
}

// Default singleton instance
let defaultService: ConversationService | null = null;

/**
 * Get the default ConversationService instance
 */
export function getConversationService(): ConversationService {
  if (!defaultService) {
    defaultService = new ConversationService();
  }
  return defaultService;
}

/**
 * Initialize the ConversationService with config
 */
export function initializeConversationService(
  config?: Partial<ConversationConfig>
): ConversationService {
  defaultService = new ConversationService(config);
  logger.info('ConversationService initialized', {
    autoExecuteThreshold: defaultService.getAutoExecuteThreshold(),
    planDirectory: defaultService.getPlanDirectory(),
  });
  return defaultService;
}
