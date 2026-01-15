/**
 * API logs repository - HTTP request/response tracking
 */

import { eq, and, desc, gte, lte, like, or } from 'drizzle-orm';
import { getDatabase, apiLogs, ApiLog, NewApiLog } from '../index';
import { logger } from '../../logger';

/**
 * API log entry
 */
export interface ApiLogEntry {
  id: string;
  method: string;
  path: string;
  statusCode: number;
  responseTimeMs: number;
  ipAddress: string | null;
  userAgent: string | null;
  triggerId: string | null;
  eventType: string | null;
  payloadSummary: Record<string, unknown> | null;
  error: string | null;
  createdAt: Date;
}

/**
 * API log filter options
 */
export interface ApiLogFilters {
  path?: string;
  triggerId?: string;
  eventType?: string;
  statusCode?: number;
  statusCodeMin?: number;
  statusCodeMax?: number;
  startDate?: Date;
  endDate?: Date;
  search?: string;
}

/**
 * Pagination options
 */
export interface PaginationOptions {
  limit?: number;
  offset?: number;
}

/**
 * API log statistics
 */
export interface ApiLogStats {
  total: number;
  success: number;
  clientErrors: number;
  serverErrors: number;
  avgResponseTimeMs: number | null;
  webhookCount: number;
}

/**
 * Convert database row to ApiLogEntry
 */
function toApiLogEntry(row: ApiLog): ApiLogEntry {
  return {
    id: row.id,
    method: row.method,
    path: row.path,
    statusCode: row.statusCode,
    responseTimeMs: row.responseTimeMs,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    triggerId: row.triggerId,
    eventType: row.eventType,
    payloadSummary: row.payloadSummary as Record<string, unknown> | null,
    error: row.error,
    createdAt: row.createdAt,
  };
}

/**
 * Create a new API log entry
 */
export async function create(entry: {
  method: string;
  path: string;
  statusCode: number;
  responseTimeMs: number;
  ipAddress?: string | null;
  userAgent?: string | null;
  triggerId?: string | null;
  eventType?: string | null;
  payloadSummary?: Record<string, unknown> | null;
  error?: string | null;
}): Promise<ApiLogEntry> {
  const db = getDatabase();

  const newEntry: NewApiLog = {
    method: entry.method,
    path: entry.path,
    statusCode: entry.statusCode,
    responseTimeMs: entry.responseTimeMs,
    ipAddress: entry.ipAddress ?? null,
    userAgent: entry.userAgent ?? null,
    triggerId: entry.triggerId ?? null,
    eventType: entry.eventType ?? null,
    payloadSummary: entry.payloadSummary ?? null,
    error: entry.error ?? null,
  };

  const result = await db.insert(apiLogs).values(newEntry).returning();

  logger.debug('API log entry created', {
    method: entry.method,
    path: entry.path,
    statusCode: entry.statusCode,
  });

  return toApiLogEntry(result[0]);
}

/**
 * Find API logs with filters
 */
export async function find(
  filters?: ApiLogFilters,
  options?: PaginationOptions
): Promise<ApiLogEntry[]> {
  const db = getDatabase();

  const conditions = [];

  if (filters?.path) {
    conditions.push(like(apiLogs.path, `%${filters.path}%`));
  }
  if (filters?.triggerId) {
    conditions.push(eq(apiLogs.triggerId, filters.triggerId));
  }
  if (filters?.eventType) {
    conditions.push(eq(apiLogs.eventType, filters.eventType));
  }
  if (filters?.statusCode) {
    conditions.push(eq(apiLogs.statusCode, filters.statusCode));
  }
  if (filters?.statusCodeMin) {
    conditions.push(gte(apiLogs.statusCode, filters.statusCodeMin));
  }
  if (filters?.statusCodeMax) {
    conditions.push(lte(apiLogs.statusCode, filters.statusCodeMax));
  }
  if (filters?.startDate) {
    conditions.push(gte(apiLogs.createdAt, filters.startDate));
  }
  if (filters?.endDate) {
    conditions.push(lte(apiLogs.createdAt, filters.endDate));
  }
  if (filters?.search) {
    conditions.push(
      or(
        like(apiLogs.path, `%${filters.search}%`),
        like(apiLogs.triggerId, `%${filters.search}%`),
        like(apiLogs.eventType, `%${filters.search}%`)
      )
    );
  }

  let query = db
    .select()
    .from(apiLogs)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(apiLogs.createdAt));

  if (options?.limit) {
    query = query.limit(options.limit) as typeof query;
  }
  if (options?.offset) {
    query = query.offset(options.offset) as typeof query;
  }

  const result = await query;
  return result.map(toApiLogEntry);
}

/**
 * Find recent API logs
 */
export async function findRecent(limit = 50): Promise<ApiLogEntry[]> {
  return find(undefined, { limit });
}

/**
 * Get API log statistics
 */
export async function getStats(filters?: {
  startDate?: Date;
  endDate?: Date;
}): Promise<ApiLogStats> {
  const db = getDatabase();

  const conditions = [];
  if (filters?.startDate) {
    conditions.push(gte(apiLogs.createdAt, filters.startDate));
  }
  if (filters?.endDate) {
    conditions.push(lte(apiLogs.createdAt, filters.endDate));
  }

  const result = await db
    .select()
    .from(apiLogs)
    .where(conditions.length > 0 ? and(...conditions) : undefined);

  const stats: ApiLogStats = {
    total: result.length,
    success: 0,
    clientErrors: 0,
    serverErrors: 0,
    avgResponseTimeMs: null,
    webhookCount: 0,
  };

  let totalResponseTime = 0;

  for (const row of result) {
    // Count by status code range
    if (row.statusCode >= 200 && row.statusCode < 300) {
      stats.success++;
    } else if (row.statusCode >= 400 && row.statusCode < 500) {
      stats.clientErrors++;
    } else if (row.statusCode >= 500) {
      stats.serverErrors++;
    }

    // Count webhooks (requests with triggerId)
    if (row.triggerId) {
      stats.webhookCount++;
    }

    totalResponseTime += row.responseTimeMs;
  }

  if (result.length > 0) {
    stats.avgResponseTimeMs = Math.round(totalResponseTime / result.length);
  }

  return stats;
}

/**
 * Count API logs with filters
 */
export async function count(filters?: ApiLogFilters): Promise<number> {
  const db = getDatabase();

  const conditions = [];

  if (filters?.path) {
    conditions.push(like(apiLogs.path, `%${filters.path}%`));
  }
  if (filters?.triggerId) {
    conditions.push(eq(apiLogs.triggerId, filters.triggerId));
  }
  if (filters?.eventType) {
    conditions.push(eq(apiLogs.eventType, filters.eventType));
  }
  if (filters?.statusCode) {
    conditions.push(eq(apiLogs.statusCode, filters.statusCode));
  }
  if (filters?.statusCodeMin) {
    conditions.push(gte(apiLogs.statusCode, filters.statusCodeMin));
  }
  if (filters?.statusCodeMax) {
    conditions.push(lte(apiLogs.statusCode, filters.statusCodeMax));
  }
  if (filters?.search) {
    conditions.push(
      or(
        like(apiLogs.path, `%${filters.search}%`),
        like(apiLogs.triggerId, `%${filters.search}%`),
        like(apiLogs.eventType, `%${filters.search}%`)
      )
    );
  }

  const result = await db
    .select()
    .from(apiLogs)
    .where(conditions.length > 0 ? and(...conditions) : undefined);

  return result.length;
}

/**
 * Clean up old API log entries
 */
export async function cleanup(olderThan: Date): Promise<number> {
  const db = getDatabase();

  const result = await db
    .delete(apiLogs)
    .where(lte(apiLogs.createdAt, olderThan))
    .returning({ id: apiLogs.id });

  logger.info('API logs cleanup', { deleted: result.length, olderThan });

  return result.length;
}
