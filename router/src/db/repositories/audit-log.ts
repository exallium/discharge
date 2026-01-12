/**
 * Audit log repository - tracking configuration changes
 */

import { eq, and, desc, gte, lte } from 'drizzle-orm';
import { getDatabase, auditLog, AuditLog, NewAuditLog } from '../index';
import { logger } from '../../logger';

/**
 * Audit entry
 */
export interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actor: string | null;
  changes: {
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
  } | null;
  ipAddress: string | null;
  createdAt: Date;
}

/**
 * Audit filter options
 */
export interface AuditFilters {
  entityType?: string;
  entityId?: string;
  action?: string;
  actor?: string;
  startDate?: Date;
  endDate?: Date;
}

/**
 * Pagination options
 */
export interface PaginationOptions {
  limit?: number;
  offset?: number;
}

/**
 * Convert database row to AuditEntry
 */
function toAuditEntry(row: AuditLog): AuditEntry {
  return {
    id: row.id,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    actor: row.actor,
    changes: row.changes as AuditEntry['changes'],
    ipAddress: row.ipAddress,
    createdAt: row.createdAt,
  };
}

/**
 * Log an audit entry
 */
export async function log(
  action: string,
  entity: {
    type: string;
    id?: string;
  },
  options?: {
    changes?: {
      before?: Record<string, unknown>;
      after?: Record<string, unknown>;
    };
    actor?: string;
    ipAddress?: string;
  }
): Promise<AuditEntry> {
  const db = getDatabase();

  const newEntry: NewAuditLog = {
    action,
    entityType: entity.type,
    entityId: entity.id ?? null,
    actor: options?.actor ?? null,
    changes: options?.changes ?? null,
    ipAddress: options?.ipAddress ?? null,
  };

  const result = await db.insert(auditLog).values(newEntry).returning();

  logger.debug('Audit log entry created', {
    action,
    entityType: entity.type,
    entityId: entity.id,
  });

  return toAuditEntry(result[0]);
}

/**
 * Find audit entries with filters
 */
export async function find(
  filters?: AuditFilters,
  options?: PaginationOptions
): Promise<AuditEntry[]> {
  const db = getDatabase();

  // Build conditions
  const conditions = [];

  if (filters?.entityType) {
    conditions.push(eq(auditLog.entityType, filters.entityType));
  }
  if (filters?.entityId) {
    conditions.push(eq(auditLog.entityId, filters.entityId));
  }
  if (filters?.action) {
    conditions.push(eq(auditLog.action, filters.action));
  }
  if (filters?.actor) {
    conditions.push(eq(auditLog.actor, filters.actor));
  }
  if (filters?.startDate) {
    conditions.push(gte(auditLog.createdAt, filters.startDate));
  }
  if (filters?.endDate) {
    conditions.push(lte(auditLog.createdAt, filters.endDate));
  }

  let query = db
    .select()
    .from(auditLog)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(auditLog.createdAt));

  if (options?.limit) {
    query = query.limit(options.limit) as typeof query;
  }
  if (options?.offset) {
    query = query.offset(options.offset) as typeof query;
  }

  const result = await query;
  return result.map(toAuditEntry);
}

/**
 * Find audit entries for a specific entity
 */
export async function findByEntity(
  entityType: string,
  entityId: string,
  options?: PaginationOptions
): Promise<AuditEntry[]> {
  return find({ entityType, entityId }, options);
}

/**
 * Find recent audit entries
 */
export async function findRecent(limit = 50): Promise<AuditEntry[]> {
  return find(undefined, { limit });
}

/**
 * Clean up old audit entries
 */
export async function cleanup(olderThan: Date): Promise<number> {
  const db = getDatabase();

  const result = await db
    .delete(auditLog)
    .where(lte(auditLog.createdAt, olderThan))
    .returning({ id: auditLog.id });

  logger.info('Audit log cleanup', { deleted: result.length, olderThan });

  return result.length;
}

/**
 * Helper to log project changes
 */
export async function logProjectChange(
  action: 'create' | 'update' | 'delete' | 'enable' | 'disable',
  projectId: string,
  options?: {
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
    actor?: string;
    ipAddress?: string;
  }
): Promise<AuditEntry> {
  return log(`project.${action}`, { type: 'project', id: projectId }, {
    changes: options?.before || options?.after ? {
      before: options.before,
      after: options.after,
    } : undefined,
    actor: options?.actor,
    ipAddress: options?.ipAddress,
  });
}

/**
 * Helper to log settings changes
 */
export async function logSettingChange(
  action: 'create' | 'update' | 'delete',
  settingKey: string,
  options?: {
    before?: string;
    after?: string;
    actor?: string;
    ipAddress?: string;
  }
): Promise<AuditEntry> {
  return log(`setting.${action}`, { type: 'setting', id: settingKey }, {
    changes: options?.before || options?.after ? {
      before: options.before ? { value: '[REDACTED]' } : undefined,
      after: options.after ? { value: '[REDACTED]' } : undefined,
    } : undefined,
    actor: options?.actor,
    ipAddress: options?.ipAddress,
  });
}

/**
 * Count audit entries
 */
export async function count(filters?: AuditFilters): Promise<number> {
  const db = getDatabase();

  const conditions = [];

  if (filters?.entityType) {
    conditions.push(eq(auditLog.entityType, filters.entityType));
  }
  if (filters?.entityId) {
    conditions.push(eq(auditLog.entityId, filters.entityId));
  }
  if (filters?.action) {
    conditions.push(eq(auditLog.action, filters.action));
  }

  const result = await db
    .select()
    .from(auditLog)
    .where(conditions.length > 0 ? and(...conditions) : undefined);

  return result.length;
}
