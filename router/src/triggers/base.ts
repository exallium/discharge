/**
 * Trigger Plugin System - Pluggable bug tracking integrations
 *
 * This module bridges between the legacy trigger system and the new service-based architecture.
 * Core types are now defined in @discharge/service-sdk and re-exported here for
 * backward compatibility.
 */

import type { ConversationEvent } from '../types/conversation';
import type { ProjectConfig } from '../db/repositories/projects';

// Re-export all trigger types from the SDK - this is the single source of truth
export type {
  WebhookHeaders,
  WebhookRequest,
  TriggerEvent,
  Tool,
  AnalysisResult,
  FixStatus,
  WebhookConfig,
  PrefetchedData,
  SecretRequirement,
} from '@discharge/service-sdk';

// Import types for use in this file
import type {
  WebhookRequest,
  TriggerEvent,
  Tool,
  FixStatus,
  WebhookConfig,
  PrefetchedData,
  SecretRequirement,
} from '@discharge/service-sdk';

/**
 * Trigger plugin interface - all bug tracking systems implement this
 *
 * Note: This interface is kept in the router because it references the full
 * ProjectConfig type from the database. The SDK has a minimal TriggerProjectConfig
 * for use in standalone service packages.
 */
export interface TriggerPlugin {
  // Identification
  id: string;
  type: string;

  // Webhook setup info
  webhookConfig: WebhookConfig;

  // Webhook handling
  validateWebhook(req: WebhookRequest): Promise<boolean>;
  parseWebhook(payload: unknown): Promise<TriggerEvent | null>;

  // Tool generation (async to support secret retrieval)
  getTools(event: TriggerEvent): Promise<Tool[]>;

  // Context generation for prompts
  getPromptContext(event: TriggerEvent): string;

  // Post-processing
  updateStatus(event: TriggerEvent, status: FixStatus): Promise<void>;
  addComment(event: TriggerEvent, comment: string): Promise<void>;
  getLink(event: TriggerEvent): string;

  // Optional: Pre-filtering
  shouldProcess?(event: TriggerEvent): Promise<boolean>;

  // Optional: Pre-fetch additional data for prompts
  /**
   * Pre-fetch additional data for inclusion in prompts
   * Called before running agents to provide immediate context
   *
   * @param event - Trigger event
   * @returns Pre-fetched data (stack traces, breadcrumbs, etc.) or undefined if not available
   */
  prefetchData?(event: TriggerEvent): Promise<PrefetchedData | undefined>;

  // ========================================
  // Conversation Support (Optional)
  // ========================================

  /**
   * Whether this trigger supports conversation mode
   */
  supportsConversation?: boolean;

  /**
   * Parse incoming webhook into a ConversationEvent
   * Used for conversation-mode triggers to normalize platform events
   *
   * @param payload - Raw webhook payload
   * @param project - Project configuration
   * @returns Normalized conversation event or null if not a conversation event
   */
  parseConversationEvent?(
    payload: unknown,
    project?: ProjectConfig
  ): Promise<ConversationEvent | null>;

  /**
   * Get unique conversation identifier from trigger event
   * Example: 'owner/repo#123' for GitHub issues
   *
   * @param event - Trigger event
   * @returns Unique conversation ID string
   */
  getConversationId?(event: TriggerEvent): string;

  /**
   * Get routing tags from trigger event
   * Used to determine route mode (ai:plan, ai:auto, ai:assist)
   *
   * @param event - Trigger event
   * @returns Array of tag strings
   */
  getRoutingTags?(event: TriggerEvent): string[];

  /**
   * Post feedback/reply to the trigger's platform
   * Example: Post a comment on the GitHub issue
   *
   * @param event - Original trigger event
   * @param message - Message content to post
   * @param project - Project configuration
   */
  postFeedback?(
    event: TriggerEvent,
    message: string,
    project?: ProjectConfig
  ): Promise<void>;

  // ========================================
  // Secret Requirements
  // ========================================

  /**
   * Get the secrets required by this trigger
   * Used to aggregate and display secrets in the UI
   *
   * @returns Array of secret requirements
   */
  getRequiredSecrets(): SecretRequirement[];
}
