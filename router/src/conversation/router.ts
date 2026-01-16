/**
 * Event Router
 *
 * Routes incoming events through the conversation state machine.
 * Determines whether to start a new job or queue the event for later.
 */

import { randomUUID } from 'crypto';
import { ConversationService, getConversationService } from './index';
import { queueFixJob } from '../queue';
import type { ConversationJobData } from '../queue/types';
import type { ConversationEvent, RouteMode } from '../types/conversation';
import type { TriggerPlugin, TriggerEvent } from '../triggers/base';
import { logger } from '../logger';

// Re-export ConversationJobData for consumers
export type { ConversationJobData } from '../queue/types';

/**
 * Result of routing an event
 */
export interface EventRouteResult {
  action: 'started_job' | 'queued_event' | 'ignored';
  conversationId?: string;
  jobId?: string;
  reason?: string;
}

/**
 * Check if job data is a conversation job
 */
export function isConversationJob(data: unknown): data is ConversationJobData {
  return (
    typeof data === 'object' &&
    data !== null &&
    'conversationId' in data &&
    'events' in data
  );
}

/**
 * Event Router
 *
 * Routes events through the conversation state machine:
 * - If conversation is IDLE: start a new job
 * - If conversation is RUNNING: queue the event
 */
export class EventRouter {
  private conversationService: ConversationService;

  constructor(conversationService?: ConversationService) {
    this.conversationService = conversationService ?? getConversationService();
  }

  /**
   * Route an incoming event from a trigger
   *
   * @param trigger - The trigger plugin that received the event
   * @param event - The normalized conversation event
   * @param triggerEvent - The original trigger event (for project lookup)
   */
  async routeEvent(
    trigger: TriggerPlugin,
    event: ConversationEvent,
    triggerEvent: TriggerEvent
  ): Promise<EventRouteResult> {
    // Get conversation ID from trigger
    const conversationId = this.getConversationId(trigger, triggerEvent, event);
    if (!conversationId) {
      return {
        action: 'ignored',
        reason: 'Could not determine conversation ID',
      };
    }

    // Get or create conversation
    const conversation = await this.conversationService.getOrCreateConversation(
      trigger.type,
      conversationId,
      triggerEvent.projectId,
      triggerEvent as unknown as Record<string, unknown>
    );

    // If conversation has a PR, ignore issue events (conversation continues on PR)
    const isPrEvent = event.type.startsWith('pr_') || event.type.includes('pull_request');
    if (conversation.prNumber && !isPrEvent) {
      logger.debug('Ignoring issue event - conversation has moved to PR', {
        conversationId: conversation.id,
        prNumber: conversation.prNumber,
        eventType: event.type,
      });
      return {
        action: 'ignored',
        conversationId: conversation.id,
        reason: `Conversation continues on PR #${conversation.prNumber}`,
      };
    }

    // Determine route mode from tags
    const tags = this.getRoutingTags(trigger, triggerEvent, event);
    const routeMode = this.conversationService.determineRouteMode(tags);

    // Check if we should update the route mode
    if (conversation.routeMode !== routeMode && conversation.state === 'idle') {
      await this.conversationService.updateStatus(conversation.id, { routeMode });
    }

    // Check max iterations
    if (this.conversationService.isMaxIterationsReached(conversation)) {
      logger.warn('Max iterations reached', {
        conversationId: conversation.id,
        iteration: conversation.iteration,
      });
      return {
        action: 'ignored',
        conversationId: conversation.id,
        reason: 'Maximum iterations reached',
      };
    }

    // Try to acquire lock
    const jobId = randomUUID();
    const lockAcquired = await this.conversationService.acquireLock(
      conversation.id,
      jobId
    );

    if (lockAcquired) {
      // Start a new job
      await this.startConversationJob(
        jobId,
        conversation.id,
        triggerEvent,
        trigger.type,
        [event],
        routeMode,
        conversation.iteration
      );

      logger.info('Started conversation job', {
        jobId,
        conversationId: conversation.id,
        triggerType: trigger.type,
        routeMode,
      });

      return {
        action: 'started_job',
        conversationId: conversation.id,
        jobId,
      };
    } else {
      // Queue the event for later processing
      await this.conversationService.queueEvent(
        conversation.id,
        event.type,
        event
      );

      logger.debug('Queued event for running conversation', {
        conversationId: conversation.id,
        eventType: event.type,
      });

      return {
        action: 'queued_event',
        conversationId: conversation.id,
        reason: 'Conversation is already running',
      };
    }
  }

  /**
   * Start a continuation job with drained events
   */
  async startContinuationJob(
    conversationId: string,
    projectId: string,
    triggerType: string,
    triggerId: string,
    events: ConversationEvent[],
    routeMode: RouteMode,
    iteration: number
  ): Promise<string> {
    const jobId = randomUUID();

    // The lock should already be held from the previous job
    // Just queue the continuation

    await this.startConversationJob(
      jobId,
      conversationId,
      { projectId, triggerId, triggerType } as TriggerEvent,
      triggerType,
      events,
      routeMode,
      iteration,
      false
    );

    logger.info('Started continuation job', {
      jobId,
      conversationId,
      eventCount: events.length,
      iteration,
    });

    return jobId;
  }

  /**
   * Queue a conversation job
   */
  private async startConversationJob(
    jobId: string,
    conversationId: string,
    triggerEvent: TriggerEvent,
    triggerType: string,
    events: ConversationEvent[],
    routeMode: RouteMode,
    iteration: number,
    isInitial = true
  ): Promise<void> {
    const jobData: ConversationJobData = {
      jobId,
      conversationId,
      projectId: triggerEvent.projectId,
      triggerType,
      triggerId: triggerEvent.triggerId,
      events,
      routeMode,
      iteration,
      isInitial,
      queuedAt: new Date().toISOString(),
    };

    // Use existing queue infrastructure
    await queueFixJob({
      event: triggerEvent,
      triggerType,
      queuedAt: jobData.queuedAt,
      conversationData: jobData,
    });
  }

  /**
   * Get conversation ID from trigger
   */
  private getConversationId(
    trigger: TriggerPlugin,
    triggerEvent: TriggerEvent,
    _event: ConversationEvent
  ): string | null {
    // If trigger implements getConversationId, use it
    if (trigger.getConversationId) {
      return trigger.getConversationId(triggerEvent);
    }

    // Default: use triggerId (e.g., 'owner/repo#123')
    return triggerEvent.triggerId;
  }

  /**
   * Get routing tags from trigger/event
   */
  private getRoutingTags(
    trigger: TriggerPlugin,
    triggerEvent: TriggerEvent,
    event: ConversationEvent
  ): string[] {
    // If trigger implements getRoutingTags, use it
    if (trigger.getRoutingTags) {
      return trigger.getRoutingTags(triggerEvent);
    }

    // Default: use event target labels
    return event.target.labels || [];
  }
}

// Default singleton instance
let defaultRouter: EventRouter | null = null;

/**
 * Get the default EventRouter instance
 */
export function getEventRouter(): EventRouter {
  if (!defaultRouter) {
    defaultRouter = new EventRouter();
  }
  return defaultRouter;
}

/**
 * Initialize the EventRouter
 */
export function initializeEventRouter(
  conversationService?: ConversationService
): EventRouter {
  defaultRouter = new EventRouter(conversationService);
  logger.info('EventRouter initialized');
  return defaultRouter;
}
