/**
 * Job history repository - tracking AI fix attempts
 */

import { eq, desc, and, lte } from 'drizzle-orm';
import { getDatabase, jobHistory, JobHistory, NewJobHistory } from '../index';
import { logger } from '../../logger';

/**
 * Job status enum
 */
export type JobStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped';

/**
 * Job history entry
 */
export interface JobHistoryEntry {
  id: string;
  jobId: string;
  projectId: string;
  triggerType: string;
  triggerId: string;
  status: JobStatus;
  fixed: boolean | null;
  reason: string | null;
  prUrl: string | null;
  analysis: {
    fixed: boolean;
    reason: string;
    confidence?: number;
    changes?: string[];
  } | null;
  queuedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  durationMs: number | null;
  error: string | null;
  createdAt: Date;
}

/**
 * Job statistics
 */
export interface JobStats {
  total: number;
  pending: number;
  running: number;
  success: number;
  failed: number;
  skipped: number;
  fixedCount: number;
  avgDurationMs: number | null;
}

/**
 * Pagination options
 */
export interface PaginationOptions {
  limit?: number;
  offset?: number;
}

/**
 * Convert database row to JobHistoryEntry
 */
function toJobHistoryEntry(row: JobHistory): JobHistoryEntry {
  return {
    id: row.id,
    jobId: row.jobId,
    projectId: row.projectId,
    triggerType: row.triggerType,
    triggerId: row.triggerId,
    status: row.status as JobStatus,
    fixed: row.fixed,
    reason: row.reason,
    prUrl: row.prUrl,
    analysis: row.analysis as JobHistoryEntry['analysis'],
    queuedAt: row.queuedAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    durationMs: row.durationMs,
    error: row.error,
    createdAt: row.createdAt,
  };
}

/**
 * Create a new job history entry
 */
export async function create(entry: {
  jobId: string;
  projectId: string;
  triggerType: string;
  triggerId: string;
  queuedAt?: Date;
}): Promise<JobHistoryEntry> {
  const db = getDatabase();

  const newEntry: NewJobHistory = {
    jobId: entry.jobId,
    projectId: entry.projectId,
    triggerType: entry.triggerType,
    triggerId: entry.triggerId,
    status: 'pending',
    queuedAt: entry.queuedAt ?? new Date(),
  };

  const result = await db.insert(jobHistory).values(newEntry).returning();

  logger.debug('Job history entry created', { jobId: entry.jobId });

  return toJobHistoryEntry(result[0]);
}

/**
 * Update job status to running
 */
export async function markRunning(jobId: string): Promise<void> {
  const db = getDatabase();

  await db
    .update(jobHistory)
    .set({
      status: 'running',
      startedAt: new Date(),
    })
    .where(eq(jobHistory.jobId, jobId));

  logger.debug('Job marked as running', { jobId });
}

/**
 * Update job with completion result
 */
export async function complete(
  jobId: string,
  result: {
    status: 'success' | 'failed' | 'skipped';
    fixed?: boolean;
    reason?: string;
    prUrl?: string;
    analysis?: JobHistoryEntry['analysis'];
    error?: string;
  }
): Promise<void> {
  const db = getDatabase();

  const now = new Date();

  // Get the job to calculate duration
  const existing = await db
    .select({ startedAt: jobHistory.startedAt })
    .from(jobHistory)
    .where(eq(jobHistory.jobId, jobId))
    .limit(1);

  const startedAt = existing[0]?.startedAt;
  const durationMs = startedAt ? now.getTime() - startedAt.getTime() : null;

  await db
    .update(jobHistory)
    .set({
      status: result.status,
      fixed: result.fixed ?? null,
      reason: result.reason ?? null,
      prUrl: result.prUrl ?? null,
      analysis: result.analysis ?? null,
      error: result.error ?? null,
      completedAt: now,
      durationMs,
    })
    .where(eq(jobHistory.jobId, jobId));

  logger.debug('Job completed', { jobId, status: result.status, fixed: result.fixed });
}

/**
 * Find job by ID
 */
export async function findById(id: string): Promise<JobHistoryEntry | undefined> {
  const db = getDatabase();

  const result = await db
    .select()
    .from(jobHistory)
    .where(eq(jobHistory.id, id))
    .limit(1);

  return result[0] ? toJobHistoryEntry(result[0]) : undefined;
}

/**
 * Find job by job ID (BullMQ job ID)
 */
export async function findByJobId(jobId: string): Promise<JobHistoryEntry | undefined> {
  const db = getDatabase();

  const result = await db
    .select()
    .from(jobHistory)
    .where(eq(jobHistory.jobId, jobId))
    .limit(1);

  return result[0] ? toJobHistoryEntry(result[0]) : undefined;
}

/**
 * Find jobs by project
 */
export async function findByProject(
  projectId: string,
  options?: PaginationOptions
): Promise<JobHistoryEntry[]> {
  const db = getDatabase();

  let query = db
    .select()
    .from(jobHistory)
    .where(eq(jobHistory.projectId, projectId))
    .orderBy(desc(jobHistory.createdAt));

  if (options?.limit) {
    query = query.limit(options.limit) as typeof query;
  }
  if (options?.offset) {
    query = query.offset(options.offset) as typeof query;
  }

  const result = await query;
  return result.map(toJobHistoryEntry);
}

/**
 * Find jobs by trigger
 */
export async function findByTrigger(
  triggerType: string,
  triggerId: string,
  options?: PaginationOptions
): Promise<JobHistoryEntry[]> {
  const db = getDatabase();

  let query = db
    .select()
    .from(jobHistory)
    .where(
      and(
        eq(jobHistory.triggerType, triggerType),
        eq(jobHistory.triggerId, triggerId)
      )
    )
    .orderBy(desc(jobHistory.createdAt));

  if (options?.limit) {
    query = query.limit(options.limit) as typeof query;
  }
  if (options?.offset) {
    query = query.offset(options.offset) as typeof query;
  }

  const result = await query;
  return result.map(toJobHistoryEntry);
}

/**
 * Get all jobs with pagination
 */
export async function findAll(options?: PaginationOptions): Promise<JobHistoryEntry[]> {
  const db = getDatabase();

  let query = db
    .select()
    .from(jobHistory)
    .orderBy(desc(jobHistory.createdAt));

  if (options?.limit) {
    query = query.limit(options.limit) as typeof query;
  }
  if (options?.offset) {
    query = query.offset(options.offset) as typeof query;
  }

  const result = await query;
  return result.map(toJobHistoryEntry);
}

/**
 * Get job statistics
 */
export async function getStats(projectId?: string): Promise<JobStats> {
  const db = getDatabase();

  const whereClause = projectId ? eq(jobHistory.projectId, projectId) : undefined;

  const result = await db
    .select()
    .from(jobHistory)
    .where(whereClause);

  const stats: JobStats = {
    total: result.length,
    pending: 0,
    running: 0,
    success: 0,
    failed: 0,
    skipped: 0,
    fixedCount: 0,
    avgDurationMs: null,
  };

  let totalDuration = 0;
  let durationCount = 0;

  for (const row of result) {
    switch (row.status) {
      case 'pending':
        stats.pending++;
        break;
      case 'running':
        stats.running++;
        break;
      case 'success':
        stats.success++;
        break;
      case 'failed':
        stats.failed++;
        break;
      case 'skipped':
        stats.skipped++;
        break;
    }

    if (row.fixed) {
      stats.fixedCount++;
    }

    if (row.durationMs) {
      totalDuration += row.durationMs;
      durationCount++;
    }
  }

  if (durationCount > 0) {
    stats.avgDurationMs = Math.round(totalDuration / durationCount);
  }

  return stats;
}

/**
 * Clean up old job history entries
 */
export async function cleanup(olderThan: Date): Promise<number> {
  const db = getDatabase();

  const result = await db
    .delete(jobHistory)
    .where(lte(jobHistory.createdAt, olderThan))
    .returning({ id: jobHistory.id });

  logger.info('Job history cleanup', { deleted: result.length, olderThan });

  return result.length;
}

/**
 * Count total jobs
 */
export async function count(projectId?: string): Promise<number> {
  const db = getDatabase();

  const whereClause = projectId ? eq(jobHistory.projectId, projectId) : undefined;

  const result = await db.select().from(jobHistory).where(whereClause);

  return result.length;
}
