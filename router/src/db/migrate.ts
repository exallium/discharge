/**
 * Database migration runner
 *
 * Handles automatic table creation and schema migrations on startup.
 * Uses Drizzle's migrate function with SQL migration files.
 */

import { sql, eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { logger } from '../logger';
import * as schema from './schema';

/**
 * Run database migrations
 * Creates tables if they don't exist, applies schema updates
 */
export async function runMigrations(
  db: PostgresJsDatabase<typeof schema>
): Promise<void> {
  logger.info('Running database migrations...');

  try {
    // Create tables using raw SQL for now
    // In a production system, you'd use drizzle-kit generate + migrate
    await createTables(db);

    logger.info('Database migrations completed successfully');
  } catch (error) {
    logger.error('Database migration failed', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
}

/**
 * Create database tables if they don't exist
 */
async function createTables(
  db: PostgresJsDatabase<typeof schema>
): Promise<void> {
  // Projects table
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS projects (
      id VARCHAR(255) PRIMARY KEY,
      repo TEXT NOT NULL,
      repo_full_name VARCHAR(255) NOT NULL UNIQUE,
      branch VARCHAR(255) NOT NULL DEFAULT 'main',
      vcs JSONB NOT NULL,
      runner JSONB,
      triggers JSONB NOT NULL DEFAULT '{}',
      constraints JSONB,
      conversation JSONB,
      enabled BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `);

  // Add conversation column if missing (for existing tables)
  await db.execute(sql`
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS conversation JSONB
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_projects_enabled ON projects(enabled)
  `);

  // Settings table
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS settings (
      key VARCHAR(255) PRIMARY KEY,
      value TEXT NOT NULL,
      encrypted BOOLEAN NOT NULL DEFAULT false,
      description TEXT,
      category VARCHAR(100) DEFAULT 'general',
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_settings_category ON settings(category)
  `);

  // Job history table
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS job_history (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      job_id VARCHAR(255) NOT NULL,
      project_id VARCHAR(255) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      trigger_type VARCHAR(100) NOT NULL,
      trigger_id VARCHAR(255) NOT NULL,
      status VARCHAR(50) NOT NULL,
      fixed BOOLEAN,
      reason TEXT,
      pr_url TEXT,
      analysis JSONB,
      queued_at TIMESTAMP WITH TIME ZONE NOT NULL,
      started_at TIMESTAMP WITH TIME ZONE,
      completed_at TIMESTAMP WITH TIME ZONE,
      duration_ms INTEGER,
      error TEXT,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_job_history_project_id ON job_history(project_id)
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_job_history_status ON job_history(status)
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_job_history_created_at ON job_history(created_at DESC)
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_job_history_trigger ON job_history(trigger_type, trigger_id)
  `);

  // Audit log table
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS audit_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      action VARCHAR(100) NOT NULL,
      entity_type VARCHAR(50) NOT NULL,
      entity_id VARCHAR(255),
      actor VARCHAR(255),
      changes JSONB,
      ip_address INET,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id)
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at DESC)
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action)
  `);

  // API logs table (HTTP request/response tracking)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS api_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      request_id VARCHAR(50) NOT NULL,
      method VARCHAR(10) NOT NULL,
      path TEXT NOT NULL,
      status_code INTEGER NOT NULL,
      response_time_ms INTEGER NOT NULL,
      ip_address INET,
      user_agent TEXT,
      trigger_id VARCHAR(255),
      event_type VARCHAR(100),
      payload_summary JSONB,
      outcome VARCHAR(50),
      outcome_reason TEXT,
      job_id VARCHAR(255),
      project_id VARCHAR(255),
      details JSONB,
      error TEXT,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `);

  // Add new columns to api_logs if they don't exist (for existing tables)
  await db.execute(sql`
    ALTER TABLE api_logs ADD COLUMN IF NOT EXISTS request_id VARCHAR(50)
  `);
  await db.execute(sql`
    ALTER TABLE api_logs ADD COLUMN IF NOT EXISTS outcome VARCHAR(50)
  `);
  await db.execute(sql`
    ALTER TABLE api_logs ADD COLUMN IF NOT EXISTS outcome_reason TEXT
  `);
  await db.execute(sql`
    ALTER TABLE api_logs ADD COLUMN IF NOT EXISTS job_id VARCHAR(255)
  `);
  await db.execute(sql`
    ALTER TABLE api_logs ADD COLUMN IF NOT EXISTS project_id VARCHAR(255)
  `);
  await db.execute(sql`
    ALTER TABLE api_logs ADD COLUMN IF NOT EXISTS details JSONB
  `);

  // Backfill request_id for existing rows (generate a placeholder)
  await db.execute(sql`
    UPDATE api_logs SET request_id = 'legacy_' || SUBSTRING(id::text, 1, 8) WHERE request_id IS NULL
  `);

  // Now make request_id NOT NULL after backfill
  await db.execute(sql`
    ALTER TABLE api_logs ALTER COLUMN request_id SET NOT NULL
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_api_logs_created_at ON api_logs(created_at DESC)
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_api_logs_path ON api_logs(path)
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_api_logs_trigger_id ON api_logs(trigger_id)
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_api_logs_status_code ON api_logs(status_code)
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_api_logs_request_id ON api_logs(request_id)
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_api_logs_outcome ON api_logs(outcome)
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_api_logs_job_id ON api_logs(job_id)
  `);

  // Conversations table (for conversational feedback loop)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS conversations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id VARCHAR(255) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      trigger_type VARCHAR(100) NOT NULL,
      external_id VARCHAR(500) NOT NULL,
      state VARCHAR(50) NOT NULL DEFAULT 'idle',
      status VARCHAR(50) NOT NULL DEFAULT 'investigating',
      current_job_id VARCHAR(255),
      iteration INTEGER NOT NULL DEFAULT 0,
      max_iterations INTEGER NOT NULL DEFAULT 5,
      context JSONB,
      last_activity_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `);

  // Add missing columns to conversations table (for existing tables)
  await db.execute(sql`
    ALTER TABLE conversations ADD COLUMN IF NOT EXISTS route_mode VARCHAR(20) NOT NULL DEFAULT 'plan_review'
  `);
  await db.execute(sql`
    ALTER TABLE conversations ADD COLUMN IF NOT EXISTS plan_ref VARCHAR(500)
  `);
  await db.execute(sql`
    ALTER TABLE conversations ADD COLUMN IF NOT EXISTS plan_version INTEGER DEFAULT 1
  `);
  await db.execute(sql`
    ALTER TABLE conversations ADD COLUMN IF NOT EXISTS confidence JSONB
  `);
  await db.execute(sql`
    ALTER TABLE conversations ADD COLUMN IF NOT EXISTS trigger_event JSONB
  `);

  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_target ON conversations(trigger_type, external_id)
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_conversations_state ON conversations(state)
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(status)
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_conversations_project ON conversations(project_id)
  `);

  // Conversation messages table
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS conversation_messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role VARCHAR(50) NOT NULL,
      content TEXT NOT NULL,
      metadata JSONB,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `);

  // Add missing columns to conversation_messages table (for existing tables)
  await db.execute(sql`
    ALTER TABLE conversation_messages ADD COLUMN IF NOT EXISTS source_type VARCHAR(50)
  `);
  await db.execute(sql`
    ALTER TABLE conversation_messages ADD COLUMN IF NOT EXISTS source_id VARCHAR(255)
  `);
  await db.execute(sql`
    ALTER TABLE conversation_messages ADD COLUMN IF NOT EXISTS source_author VARCHAR(255)
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON conversation_messages(conversation_id)
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_messages_created_at ON conversation_messages(created_at)
  `);

  // Pending events table (queued events for active conversations)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS pending_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      event_type VARCHAR(100) NOT NULL,
      payload JSONB NOT NULL,
      processed_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `);

  // Fix column names in pending_events (schema expects event_payload and queued_at)
  // Try to rename payload -> event_payload (ignore if already renamed or doesn't exist)
  try {
    await db.execute(sql`
      ALTER TABLE pending_events RENAME COLUMN payload TO event_payload
    `);
  } catch {
    // Column may already be renamed or not exist
  }
  await db.execute(sql`
    ALTER TABLE pending_events ADD COLUMN IF NOT EXISTS event_payload JSONB
  `);
  await db.execute(sql`
    ALTER TABLE pending_events ADD COLUMN IF NOT EXISTS queued_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  `);
  // Backfill queued_at from created_at if needed
  await db.execute(sql`
    UPDATE pending_events SET queued_at = created_at WHERE queued_at IS NULL
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_pending_events_conversation ON pending_events(conversation_id)
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_pending_events_unprocessed ON pending_events(conversation_id, processed_at)
  `);

  logger.debug('All database tables created/verified');

  // Run data migrations
  await migrateTriggerFormat(db);
  await migrateVcsOwnerRepo(db);
}

/**
 * Migrate trigger format from old to new structure
 * Old: { 'github-issues': {} }
 * New: { github: { issues: true } }
 */
async function migrateTriggerFormat(
  db: PostgresJsDatabase<typeof schema>
): Promise<void> {
  // Get all projects and filter in JS (simpler than JSONB operators)
  const allProjects = await db.select().from(schema.projects);

  const projectsToMigrate = allProjects.filter((p) => {
    const triggers = p.triggers as Record<string, unknown> | null;
    if (!triggers) return false;

    // Check for old format
    if ('github-issues' in triggers) return true;

    // Check sentry without enabled flag
    if (triggers.sentry && typeof triggers.sentry === 'object') {
      const sentry = triggers.sentry as Record<string, unknown>;
      if (!('enabled' in sentry)) return true;
    }

    // Check circleci without enabled flag
    if (triggers.circleci && typeof triggers.circleci === 'object') {
      const circleci = triggers.circleci as Record<string, unknown>;
      if (!('enabled' in circleci)) return true;
    }

    return false;
  });

  if (projectsToMigrate.length === 0) {
    return;
  }

  logger.info(`Migrating trigger format for ${projectsToMigrate.length} project(s)`);

  for (const project of projectsToMigrate) {
    const oldTriggers = (project.triggers as Record<string, unknown>) || {};
    const newTriggers: Record<string, unknown> = {};

    // Migrate github-issues → github.issues
    if ('github-issues' in oldTriggers) {
      newTriggers.github = { issues: true };
    } else if (oldTriggers.github) {
      newTriggers.github = oldTriggers.github;
    }

    // Migrate sentry (ensure it has enabled: true)
    if (oldTriggers.sentry) {
      const sentry = oldTriggers.sentry as Record<string, unknown>;
      if (!('enabled' in sentry)) {
        newTriggers.sentry = { ...sentry, enabled: true };
      } else {
        newTriggers.sentry = sentry;
      }
    }

    // Migrate circleci (ensure it has enabled: true)
    if (oldTriggers.circleci) {
      const circleci = oldTriggers.circleci as Record<string, unknown>;
      if (!('enabled' in circleci)) {
        newTriggers.circleci = { ...circleci, enabled: true };
      } else {
        newTriggers.circleci = circleci;
      }
    }

    // Copy any other triggers as-is
    for (const key of Object.keys(oldTriggers)) {
      if (!['github-issues', 'github', 'sentry', 'circleci'].includes(key)) {
        newTriggers[key] = oldTriggers[key];
      }
    }

    // Update the project using Drizzle
    await db
      .update(schema.projects)
      .set({
        triggers: newTriggers,
        updatedAt: new Date(),
      })
      .where(eq(schema.projects.id, project.id));

    logger.debug(`Migrated triggers for project ${project.id}`, {
      from: oldTriggers,
      to: newTriggers,
    });
  }

  logger.info('Trigger format migration completed');
}

/**
 * Migrate vcs config to include owner and repo from repoFullName
 * Old: { type: 'github' }
 * New: { type: 'github', owner: 'owner', repo: 'repo' }
 */
async function migrateVcsOwnerRepo(
  db: PostgresJsDatabase<typeof schema>
): Promise<void> {
  // Get all projects and filter those missing owner/repo in vcs
  const allProjects = await db.select().from(schema.projects);

  const projectsToMigrate = allProjects.filter((p) => {
    const vcs = p.vcs as { type: string; owner?: string; repo?: string } | null;
    if (!vcs) return false;
    // Check if owner or repo is missing
    return !vcs.owner || !vcs.repo;
  });

  if (projectsToMigrate.length === 0) {
    return;
  }

  logger.info(`Migrating vcs owner/repo for ${projectsToMigrate.length} project(s)`);

  for (const project of projectsToMigrate) {
    const oldVcs = project.vcs as { type: 'github' | 'gitlab' | 'bitbucket' | 'self-hosted'; owner?: string; repo?: string };
    const [owner, repo] = project.repoFullName.split('/');

    if (!owner || !repo) {
      logger.warn(`Cannot parse owner/repo from repoFullName: ${project.repoFullName}`);
      continue;
    }

    const newVcs = {
      type: oldVcs.type,
      owner,
      repo,
      reviewers: (oldVcs as Record<string, unknown>).reviewers as string[] | undefined,
      labels: (oldVcs as Record<string, unknown>).labels as string[] | undefined,
    };

    // Update the project using Drizzle
    await db
      .update(schema.projects)
      .set({
        vcs: newVcs,
        updatedAt: new Date(),
      })
      .where(eq(schema.projects.id, project.id));

    logger.debug(`Migrated vcs for project ${project.id}`, {
      from: oldVcs,
      to: newVcs,
    });
  }

  logger.info('VCS owner/repo migration completed');
}

/**
 * Drop all tables (for testing only)
 */
export async function dropAllTables(
  db: PostgresJsDatabase<typeof schema>
): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Cannot drop tables in production');
  }

  logger.warn('Dropping all database tables...');

  await db.execute(sql`DROP TABLE IF EXISTS pending_events CASCADE`);
  await db.execute(sql`DROP TABLE IF EXISTS conversation_messages CASCADE`);
  await db.execute(sql`DROP TABLE IF EXISTS conversations CASCADE`);
  await db.execute(sql`DROP TABLE IF EXISTS api_logs CASCADE`);
  await db.execute(sql`DROP TABLE IF EXISTS audit_log CASCADE`);
  await db.execute(sql`DROP TABLE IF EXISTS job_history CASCADE`);
  await db.execute(sql`DROP TABLE IF EXISTS settings CASCADE`);
  await db.execute(sql`DROP TABLE IF EXISTS projects CASCADE`);

  logger.warn('All database tables dropped');
}
