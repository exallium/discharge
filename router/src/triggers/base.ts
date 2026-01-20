import type { ConversationEvent } from '../types/conversation';
import type { ProjectConfig } from '../db/repositories/projects';

/**
 * Generic webhook headers interface
 * Works with both Express headers (object) and Next.js Headers (class)
 */
export interface WebhookHeaders {
  get(name: string): string | null;
}

/**
 * Generic webhook request interface
 * Works with both Express Request and Next.js NextRequest
 */
export interface WebhookRequest {
  headers: WebhookHeaders;
  body: unknown;
  rawBody?: string; // Raw body string for signature verification
}

/**
 * Normalized event from any bug tracking trigger
 */
export interface TriggerEvent {
  // Core identification
  triggerType: string;           // 'sentry', 'github-issues', etc.
  triggerId: string;             // Issue ID, event ID, job ID, etc.
  projectId: string;             // Which project config to use

  // Display info
  title: string;
  description: string;

  // Structured metadata
  metadata: {
    severity?: 'low' | 'medium' | 'high' | 'critical';
    tags?: string[];
    environment?: string;
    [key: string]: unknown;
  };

  // Links
  links?: {
    web?: string;
    api?: string;
  };

  // Raw payload (for tool use)
  raw: unknown;
}

/**
 * Tool definition for bash scripts dynamically generated per trigger
 */
export interface Tool {
  name: string;                  // CLI command name
  script: string;                // Bash script content
  description: string;           // Usage instructions
  env?: Record<string, string>;  // Additional env vars needed
}

/**
 * Result of Claude's analysis
 */
export interface AnalysisResult {
  canAutoFix: boolean;
  confidence: 'high' | 'medium' | 'low';
  summary: string;
  rootCause: string;
  proposedFix?: string;
  reason?: string;
  filesInvolved: string[];
  complexity: 'trivial' | 'simple' | 'moderate' | 'complex';
  /** Target repo for PR ('main' or 'owner/repo' from secondaryRepos) */
  targetRepo?: string;
}

/**
 * Status of a fix attempt
 */
export interface FixStatus {
  fixed: boolean;
  reason?: string;
  analysis?: AnalysisResult;
  prUrl?: string;
  /** Investigation context when running in investigate or investigate_and_fix mode */
  investigationContext?: {
    rootCause: string;
    filesInvolved: string[];
    suggestedApproach: string;
    summary?: string;
  };
}

/**
 * Webhook configuration info for setup documentation
 */
export interface WebhookConfig {
  /** Events to subscribe to in the external service */
  events: string[];
  /** URL to setup documentation */
  docsUrl: string;
  /** Content type expected (usually application/json) */
  contentType?: string;
}

/**
 * Prefetched data from triggers for inclusion in prompts
 * Provides immediate context so agents don't need to fetch it themselves.
 *
 * This is a generic interface - any trigger can implement prefetchData() to
 * provide pre-fetched data from their respective systems (Sentry, Datadog,
 * CircleCI, GitHub Actions, etc.)
 */
export interface PrefetchedData {
  /** Formatted markdown with issue/error details */
  summary: string;
  /** Full stack trace if available (from any error tracking system) */
  stackTrace?: string;
  /** Breadcrumbs/event trail if available (Sentry, LogRocket, etc.) */
  breadcrumbs?: string;
  /** Additional context (request data, user info, logs, etc.) */
  additionalContext?: string;
}

/**
 * Secret requirement declaration for plugins
 * Allows multiple plugins to share the same secret
 */
export interface SecretRequirement {
  /** Shared secret identifier (e.g., 'github_token') - used for display/deduplication */
  id: string;
  /** Display label for UI (e.g., 'GitHub Token') */
  label: string;
  /** Help text describing what this secret is used for */
  description: string;
  /** Whether this secret is required for the plugin to function */
  required: boolean;
  /** Plugin namespace for storage (e.g., 'github', 'claude') */
  plugin: string;
  /** Key within plugin namespace (e.g., 'token', 'oauth_token') */
  key: string;
}

/**
 * Trigger plugin interface - all bug tracking systems implement this
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
