/**
 * Database connection and initialization
 *
 * Provides lazy-initialized PostgreSQL connection using Drizzle ORM.
 * Follows the same pattern as queue/index.ts for consistency.
 */

import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { logger } from '../logger';
import * as schema from './schema';

// Connection instance (lazy initialized)
let db: PostgresJsDatabase<typeof schema> | null = null;
let client: postgres.Sql | null = null;

/**
 * Get or create the database connection
 * Lazily initializes the connection on first call
 */
export function getDatabase(): PostgresJsDatabase<typeof schema> {
  if (!db) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is not set');
    }

    // Create postgres client with connection pooling
    client = postgres(connectionString, {
      max: 10, // Maximum pool size
      idle_timeout: 20, // Close idle connections after 20 seconds
      connect_timeout: 10, // Connection timeout in seconds
      onnotice: () => {}, // Suppress notice messages
    });

    // Create Drizzle instance with schema for relational queries
    db = drizzle(client, { schema });

    logger.info('Database connection initialized', {
      host: connectionString.replace(/:[^:@]+@/, ':***@'), // Mask password in logs
    });
  }

  return db;
}

/**
 * Check if database has been initialized
 */
export function isDatabaseInitialized(): boolean {
  return db !== null && client !== null;
}

/**
 * Check if database connection is healthy
 * Used by health check endpoint
 */
export async function checkDatabaseHealth(): Promise<{
  healthy: boolean;
  latency: number;
  version: string;
  error?: string;
}> {
  try {
    const start = Date.now();

    // Simple query to check connection
    if (!client) {
      return { healthy: false, latency: 0, version: 'unknown', error: 'Database not initialized' };
    }

    // Get version and check connection
    const result = await client`SELECT version()`;
    const latency = Date.now() - start;
    const version = (result[0]?.version as string)?.split(' ')[1] || 'unknown';

    return { healthy: true, latency, version };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { healthy: false, latency: 0, version: 'unknown', error: message };
  }
}

/**
 * Close the database connection gracefully
 * Called during shutdown
 */
export async function closeDatabase(): Promise<void> {
  if (client) {
    logger.info('Closing database connection...');
    await client.end();
    client = null;
    db = null;
    logger.info('Database connection closed');
  }
}

/**
 * Initialize database (run migrations, check connection)
 * Called during application startup
 */
export async function initializeDatabase(): Promise<void> {
  logger.info('Initializing database...');

  try {
    // Get database instance (creates connection)
    const database = getDatabase();

    // Verify connection with a simple query
    const health = await checkDatabaseHealth();
    if (!health.healthy) {
      throw new Error(`Database health check failed: ${health.error}`);
    }

    logger.info('Database initialized successfully', {
      latency: `${health.latency}ms`,
      version: health.version,
    });

    // Run migrations (imported dynamically to avoid circular deps)
    const { runMigrations } = await import('./migrate');
    await runMigrations(database);
  } catch (error) {
    logger.error('Failed to initialize database', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
}

/**
 * Check if this is a first-run setup (no projects or settings exist)
 */
export async function isFirstRunSetup(): Promise<boolean> {
  try {
    const database = getDatabase();

    // Check if any projects exist
    const projectCount = await database
      .select()
      .from(schema.projects)
      .limit(1);

    // Check if critical settings exist
    const criticalSettings = await database
      .select()
      .from(schema.settings)
      .limit(1);

    return projectCount.length === 0 && criticalSettings.length === 0;
  } catch (error) {
    logger.warn('Error checking first-run status, assuming first run', {
      error: error instanceof Error ? error.message : String(error),
    });
    return true;
  }
}

// Re-export schema for convenience
export * from './schema';
