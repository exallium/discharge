/**
 * Database access for MCP server
 *
 * Provides read-only access to project secrets stored in PostgreSQL.
 * Uses direct pg client (no Drizzle) to keep the container lightweight.
 */

import pg from 'pg';

// Cached pool
let pool: pg.Pool | null = null;

/**
 * Get or create the database pool
 */
export function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is not set');
    }

    pool = new pg.Pool({
      connectionString,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
  }

  return pool;
}

/**
 * Close the database pool
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/**
 * Get a project by ID
 */
export async function getProject(projectId: string): Promise<{
  id: string;
  repo: string;
  repoFullName: string;
  triggers: Record<string, unknown>;
} | null> {
  const db = getPool();
  const result = await db.query(
    'SELECT id, repo, repo_full_name as "repoFullName", triggers FROM projects WHERE id = $1',
    [projectId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return result.rows[0];
}

/**
 * Get a decrypted setting value
 * Note: Encryption is handled by the decrypt function from encryption.ts
 */
export async function getSetting(key: string): Promise<{
  value: string;
  encrypted: boolean;
} | null> {
  const db = getPool();
  const result = await db.query(
    'SELECT value, encrypted FROM settings WHERE key = $1',
    [key]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return result.rows[0];
}
