/**
 * Database schema definitions using Drizzle ORM
 *
 * Tables:
 * - projects: Repository configurations
 * - settings: Global configuration (tokens, secrets)
 * - job_history: AI fix attempt tracking
 * - audit_log: Configuration change tracking
 * - trusted_devices: Device trust for TOTP 2FA
 * - api_logs: HTTP request/response tracking
 * - conversations: Conversational feedback loop state
 * - conversation_messages: Message history for conversations
 * - pending_events: Queued events for active conversations
 */

import {
  pgTable,
  varchar,
  text,
  boolean,
  timestamp,
  jsonb,
  uuid,
  integer,
  inet,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import type {
  ConversationState,
  RouteMode,
  WorkflowStatus,
  ConfidenceAssessment,
  ConversationEvent,
} from '../types/conversation';

/**
 * Projects table - Repository configurations
 */
export const projects = pgTable(
  'projects',
  {
    id: varchar('id', { length: 255 }).primaryKey(),
    repo: text('repo').notNull(),
    repoFullName: varchar('repo_full_name', { length: 255 }).notNull().unique(),
    branch: varchar('branch', { length: 255 }).notNull().default('main'),

    // JSONB columns for flexible configuration
    vcs: jsonb('vcs').notNull().$type<{
      type: 'github' | 'gitlab' | 'bitbucket' | 'self-hosted';
      owner: string;
      repo: string;
      reviewers?: string[];
      labels?: string[];
    }>(),

    runner: jsonb('runner').$type<{
      type?: string;
      timeout?: number;
      env?: Record<string, string>;
    }>(),

    triggers: jsonb('triggers').notNull().default({}).$type<Record<string, unknown>>(),

    constraints: jsonb('constraints').$type<{
      maxAttemptsPerDay?: number;
      allowedPaths?: string[];
      excludedPaths?: string[];
    }>(),

    // Conversation mode configuration
    conversation: jsonb('conversation').$type<{
      enabled?: boolean;
      autoExecuteThreshold?: number;
      maxIterations?: number;
      planDirectory?: string;
      routingTags?: {
        plan?: string;
        auto?: string;
        assist?: string;
      };
    }>(),

    // Status
    enabled: boolean('enabled').notNull().default(true),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_projects_enabled').on(table.enabled),
  ]
);

/**
 * Settings table - Global configuration (tokens, secrets)
 * Project-specific settings have a non-null project_id and cascade delete with the project
 */
export const settings = pgTable(
  'settings',
  {
    key: varchar('key', { length: 255 }).primaryKey(),
    value: text('value').notNull(),
    encrypted: boolean('encrypted').notNull().default(false),
    description: text('description'),
    category: varchar('category', { length: 100 }).default('general'),

    // Project ownership - null means global setting, non-null means project-specific
    projectId: varchar('project_id', { length: 255 }).references(() => projects.id, { onDelete: 'cascade' }),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_settings_category').on(table.category),
    index('idx_settings_project_id').on(table.projectId),
  ]
);

/**
 * Job history table - AI fix attempt tracking
 */
export const jobHistory = pgTable(
  'job_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobId: varchar('job_id', { length: 255 }).notNull(),
    projectId: varchar('project_id', { length: 255 })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),

    // Trigger info
    triggerType: varchar('trigger_type', { length: 100 }).notNull(),
    triggerId: varchar('trigger_id', { length: 255 }).notNull(),

    // Result
    status: varchar('status', { length: 50 }).notNull(), // pending, running, success, failed, skipped
    fixed: boolean('fixed'),
    reason: text('reason'),
    prUrl: text('pr_url'),

    // Analysis result (full JSON)
    analysis: jsonb('analysis').$type<{
      fixed: boolean;
      reason: string;
      confidence?: number;
      changes?: string[];
    }>(),

    // Timing
    queuedAt: timestamp('queued_at', { withTimezone: true }).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    durationMs: integer('duration_ms'),

    // Error info
    error: text('error'),

    // CLI/kanban fields
    branchName: varchar('branch_name', { length: 255 }),
    source: varchar('source', { length: 50 }), // 'webhook' | 'manual' | 'cli'

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_job_history_project_id').on(table.projectId),
    index('idx_job_history_status').on(table.status),
    index('idx_job_history_created_at').on(table.createdAt),
    index('idx_job_history_trigger').on(table.triggerType, table.triggerId),
    index('idx_job_history_source').on(table.source),
  ]
);

/**
 * Audit log table - Configuration change tracking
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    action: varchar('action', { length: 100 }).notNull(), // project.create, project.update, settings.update, etc.
    entityType: varchar('entity_type', { length: 50 }).notNull(),
    entityId: varchar('entity_id', { length: 255 }),
    actor: varchar('actor', { length: 255 }), // Username or 'system'
    changes: jsonb('changes').$type<{
      before?: Record<string, unknown>;
      after?: Record<string, unknown>;
    }>(),
    ipAddress: inet('ip_address'),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_audit_log_entity').on(table.entityType, table.entityId),
    index('idx_audit_log_created_at').on(table.createdAt),
    index('idx_audit_log_action').on(table.action),
  ]
);

/**
 * Trusted devices table - Device trust for TOTP 2FA
 */
export const trustedDevices = pgTable(
  'trusted_devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    username: varchar('username', { length: 255 }).notNull(),
    deviceToken: varchar('device_token', { length: 255 }).notNull().unique(),
    userAgent: text('user_agent'),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('idx_trusted_devices_username').on(table.username),
    index('idx_trusted_devices_token').on(table.deviceToken),
    index('idx_trusted_devices_expires').on(table.expiresAt),
  ]
);

/**
 * Outcome type for API logs
 * Describes what happened with the request
 */
export type ApiLogOutcome =
  | 'success'           // Request completed successfully
  | 'queued'            // Job was queued for processing
  | 'filtered'          // Event was filtered (not processed)
  | 'validation_failed' // Webhook signature/auth failed
  | 'not_found'         // Resource not found
  | 'error';            // Server error

/**
 * API logs table - HTTP request/response tracking with webhook focus
 */
export const apiLogs = pgTable(
  'api_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Request tracing
    requestId: varchar('request_id', { length: 50 }).notNull(),

    // Request info
    method: varchar('method', { length: 10 }).notNull(),
    path: text('path').notNull(),
    statusCode: integer('status_code').notNull(),
    responseTimeMs: integer('response_time_ms').notNull(),
    ipAddress: inet('ip_address'),
    userAgent: text('user_agent'),

    // Webhook-specific fields
    triggerId: varchar('trigger_id', { length: 255 }),
    eventType: varchar('event_type', { length: 100 }),
    payloadSummary: jsonb('payload_summary').$type<Record<string, unknown>>(),

    // Outcome tracking
    outcome: varchar('outcome', { length: 50 }).$type<ApiLogOutcome>(),
    outcomeReason: text('outcome_reason'), // Human-readable explanation
    jobId: varchar('job_id', { length: 255 }), // Link to queued job if applicable
    projectId: varchar('project_id', { length: 255 }), // Project that handled the request

    // Detailed info for debugging (expandable in UI)
    details: jsonb('details').$type<{
      validationResult?: { valid: boolean; reason?: string };
      parseResult?: { success: boolean; reason?: string };
      filterResult?: { processed: boolean; reason?: string };
      queueResult?: { jobId?: string; error?: string; conversationId?: string; action?: string };
      eventInfo?: { triggerType?: string; triggerId?: string; title?: string };
      responseBody?: Record<string, unknown>;
      error?: { message?: string; stack?: string };
      [key: string]: unknown;
    }>(),

    // Response/error
    error: text('error'),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_api_logs_created_at').on(table.createdAt),
    index('idx_api_logs_path').on(table.path),
    index('idx_api_logs_trigger_id').on(table.triggerId),
    index('idx_api_logs_status_code').on(table.statusCode),
    index('idx_api_logs_request_id').on(table.requestId),
    index('idx_api_logs_outcome').on(table.outcome),
    index('idx_api_logs_job_id').on(table.jobId),
  ]
);

/**
 * Conversations table - Conversational feedback loop state
 */
export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Unique key - trigger-specific identifier
    triggerType: varchar('trigger_type', { length: 100 }).notNull(),
    externalId: varchar('external_id', { length: 500 }).notNull(), // e.g., 'owner/repo#123'
    projectId: varchar('project_id', { length: 255 })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),

    // State machine
    state: varchar('state', { length: 20 }).notNull().default('idle').$type<ConversationState>(),
    currentJobId: varchar('current_job_id', { length: 255 }),

    // Routing
    routeMode: varchar('route_mode', { length: 20 }).notNull().default('plan_review').$type<RouteMode>(),
    status: varchar('status', { length: 20 }).notNull().default('pending').$type<WorkflowStatus>(),
    iteration: integer('iteration').notNull().default(0),

    // Plan tracking (VCS-agnostic reference)
    planRef: varchar('plan_ref', { length: 500 }),
    planVersion: integer('plan_version').default(1),

    // PR tracking - once a PR is created, conversation shifts to PR
    prNumber: integer('pr_number'),
    prUrl: varchar('pr_url', { length: 500 }),

    // Analysis
    confidence: jsonb('confidence').$type<ConfidenceAssessment>(),
    triggerEvent: jsonb('trigger_event').$type<Record<string, unknown>>(),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_conversations_target').on(table.triggerType, table.externalId),
    index('idx_conversations_state').on(table.state),
    index('idx_conversations_status').on(table.status),
    index('idx_conversations_project').on(table.projectId),
    index('idx_conversations_pr').on(table.projectId, table.prNumber),
  ]
);

/**
 * Conversation messages table - Message history for conversations
 */
export const conversationMessages = pgTable(
  'conversation_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),

    // Message content
    role: varchar('role', { length: 20 }).notNull(), // 'user' | 'assistant' | 'system'
    content: text('content').notNull(),

    // Source event info (for traceability)
    sourceType: varchar('source_type', { length: 50 }), // Trigger-specific event type
    sourceId: varchar('source_id', { length: 255 }), // External ID from trigger
    sourceAuthor: varchar('source_author', { length: 255 }),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_messages_conversation').on(table.conversationId),
    index('idx_messages_created_at').on(table.createdAt),
  ]
);

/**
 * Pending events table - Queued events for active conversations
 */
export const pendingEvents = pgTable(
  'pending_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),

    // Event data
    eventType: varchar('event_type', { length: 50 }).notNull(), // Trigger-specific event type
    eventPayload: jsonb('event_payload').notNull().$type<ConversationEvent>(),

    // Timestamps
    queuedAt: timestamp('queued_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }), // null = unprocessed
  },
  (table) => [
    index('idx_pending_events_conversation').on(table.conversationId),
    index('idx_pending_events_unprocessed').on(table.conversationId, table.processedAt),
  ]
);

/**
 * Relations
 */
export const projectsRelations = relations(projects, ({ many }) => ({
  jobs: many(jobHistory),
  conversations: many(conversations),
}));

export const jobHistoryRelations = relations(jobHistory, ({ one }) => ({
  project: one(projects, {
    fields: [jobHistory.projectId],
    references: [projects.id],
  }),
}));

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  project: one(projects, {
    fields: [conversations.projectId],
    references: [projects.id],
  }),
  messages: many(conversationMessages),
  pendingEvents: many(pendingEvents),
}));

export const conversationMessagesRelations = relations(conversationMessages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [conversationMessages.conversationId],
    references: [conversations.id],
  }),
}));

export const pendingEventsRelations = relations(pendingEvents, ({ one }) => ({
  conversation: one(conversations, {
    fields: [pendingEvents.conversationId],
    references: [conversations.id],
  }),
}));

/**
 * Type exports for use in application code
 */
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;

export type Setting = typeof settings.$inferSelect;
export type NewSetting = typeof settings.$inferInsert;

export type JobHistory = typeof jobHistory.$inferSelect;
export type NewJobHistory = typeof jobHistory.$inferInsert;

export type AuditLog = typeof auditLog.$inferSelect;
export type NewAuditLog = typeof auditLog.$inferInsert;

export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;

export type ConversationMessage = typeof conversationMessages.$inferSelect;
export type NewConversationMessage = typeof conversationMessages.$inferInsert;

export type PendingEvent = typeof pendingEvents.$inferSelect;
export type NewPendingEvent = typeof pendingEvents.$inferInsert;

export type TrustedDevice = typeof trustedDevices.$inferSelect;
export type NewTrustedDevice = typeof trustedDevices.$inferInsert;

export type ApiLog = typeof apiLogs.$inferSelect;
export type NewApiLog = typeof apiLogs.$inferInsert;
