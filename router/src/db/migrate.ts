/**
 * Database migration runner
 *
 * Handles automatic table creation and schema migrations on startup.
 * Uses Drizzle's migrate function with SQL migration files.
 */

import { sql } from 'drizzle-orm';
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
      enabled BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
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

  logger.debug('All database tables created/verified');
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

  await db.execute(sql`DROP TABLE IF EXISTS audit_log CASCADE`);
  await db.execute(sql`DROP TABLE IF EXISTS job_history CASCADE`);
  await db.execute(sql`DROP TABLE IF EXISTS settings CASCADE`);
  await db.execute(sql`DROP TABLE IF EXISTS projects CASCADE`);

  logger.warn('All database tables dropped');
}
