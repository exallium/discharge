/**
 * Database schema definitions using Drizzle ORM
 *
 * Tables:
 * - projects: Repository configurations
 * - settings: Global configuration (tokens, secrets)
 * - job_history: AI fix attempt tracking
 * - audit_log: Configuration change tracking
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
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

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
 */
export const settings = pgTable(
  'settings',
  {
    key: varchar('key', { length: 255 }).primaryKey(),
    value: text('value').notNull(),
    encrypted: boolean('encrypted').notNull().default(false),
    description: text('description'),
    category: varchar('category', { length: 100 }).default('general'),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_settings_category').on(table.category),
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

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_job_history_project_id').on(table.projectId),
    index('idx_job_history_status').on(table.status),
    index('idx_job_history_created_at').on(table.createdAt),
    index('idx_job_history_trigger').on(table.triggerType, table.triggerId),
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
 * Relations
 */
export const projectsRelations = relations(projects, ({ many }) => ({
  jobs: many(jobHistory),
}));

export const jobHistoryRelations = relations(jobHistory, ({ one }) => ({
  project: one(projects, {
    fields: [jobHistory.projectId],
    references: [projects.id],
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
