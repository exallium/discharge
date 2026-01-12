/**
 * Projects repository - CRUD operations for project configurations
 */

import { eq } from 'drizzle-orm';
import { getDatabase, projects, Project, NewProject } from '../index';
import { logger } from '../../logger';

/**
 * Project configuration matching the existing ProjectConfig interface
 */
export interface ProjectConfig {
  id: string;
  repo: string;
  repoFullName: string;
  branch: string;
  vcs: {
    type: 'github' | 'gitlab' | 'bitbucket' | 'self-hosted';
    owner: string;
    repo: string;
    reviewers?: string[];
    labels?: string[];
  };
  runner?: {
    type?: string;
    timeout?: number;
    env?: Record<string, string>;
  };
  triggers: Record<string, unknown>;
  constraints?: {
    maxAttemptsPerDay?: number;
    allowedPaths?: string[];
    excludedPaths?: string[];
  };
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Convert database row to ProjectConfig
 */
function toProjectConfig(row: Project): ProjectConfig {
  return {
    id: row.id,
    repo: row.repo,
    repoFullName: row.repoFullName,
    branch: row.branch,
    vcs: row.vcs,
    runner: row.runner ?? undefined,
    triggers: row.triggers as Record<string, unknown>,
    constraints: row.constraints ?? undefined,
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Find a project by its ID
 */
export async function findById(id: string): Promise<ProjectConfig | undefined> {
  const db = getDatabase();
  const result = await db
    .select()
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);

  return result[0] ? toProjectConfig(result[0]) : undefined;
}

/**
 * Find a project by repository full name (owner/repo)
 */
export async function findByRepo(repoFullName: string): Promise<ProjectConfig | undefined> {
  const db = getDatabase();
  const result = await db
    .select()
    .from(projects)
    .where(eq(projects.repoFullName, repoFullName))
    .limit(1);

  return result[0] ? toProjectConfig(result[0]) : undefined;
}

/**
 * Find projects by trigger source with a custom matcher
 */
export async function findBySource(
  sourceType: string,
  matcher: (config: Record<string, unknown>) => boolean
): Promise<ProjectConfig[]> {
  const db = getDatabase();

  // Get all enabled projects
  const result = await db
    .select()
    .from(projects)
    .where(eq(projects.enabled, true));

  // Filter by trigger source
  return result
    .filter((row) => {
      const triggers = row.triggers as Record<string, unknown>;
      const triggerConfig = triggers[sourceType];
      if (!triggerConfig) return false;
      return matcher(triggerConfig as Record<string, unknown>);
    })
    .map(toProjectConfig);
}

/**
 * Get all projects
 */
export async function findAll(includeDisabled = false): Promise<ProjectConfig[]> {
  const db = getDatabase();

  const query = includeDisabled
    ? db.select().from(projects)
    : db.select().from(projects).where(eq(projects.enabled, true));

  const result = await query;
  return result.map(toProjectConfig);
}

/**
 * Create a new project
 */
export async function create(
  project: Omit<ProjectConfig, 'createdAt' | 'updatedAt' | 'enabled'> & { enabled?: boolean }
): Promise<ProjectConfig> {
  const db = getDatabase();

  const newProject: NewProject = {
    id: project.id,
    repo: project.repo,
    repoFullName: project.repoFullName,
    branch: project.branch,
    vcs: project.vcs,
    runner: project.runner ?? null,
    triggers: project.triggers,
    constraints: project.constraints ?? null,
    enabled: project.enabled ?? true,
  };

  const result = await db.insert(projects).values(newProject).returning();

  logger.info('Project created', { projectId: project.id });

  return toProjectConfig(result[0]);
}

/**
 * Update an existing project
 */
export async function update(
  id: string,
  updates: Partial<Omit<ProjectConfig, 'id' | 'createdAt' | 'updatedAt'>>
): Promise<ProjectConfig | undefined> {
  const db = getDatabase();

  const updateData: Partial<NewProject> = {
    ...(updates.repo !== undefined && { repo: updates.repo }),
    ...(updates.repoFullName !== undefined && { repoFullName: updates.repoFullName }),
    ...(updates.branch !== undefined && { branch: updates.branch }),
    ...(updates.vcs !== undefined && { vcs: updates.vcs }),
    ...(updates.runner !== undefined && { runner: updates.runner }),
    ...(updates.triggers !== undefined && { triggers: updates.triggers }),
    ...(updates.constraints !== undefined && { constraints: updates.constraints }),
    ...(updates.enabled !== undefined && { enabled: updates.enabled }),
    updatedAt: new Date(),
  };

  const result = await db
    .update(projects)
    .set(updateData)
    .where(eq(projects.id, id))
    .returning();

  if (result[0]) {
    logger.info('Project updated', { projectId: id });
    return toProjectConfig(result[0]);
  }

  return undefined;
}

/**
 * Delete a project
 */
export async function remove(id: string): Promise<boolean> {
  const db = getDatabase();

  const result = await db
    .delete(projects)
    .where(eq(projects.id, id))
    .returning({ id: projects.id });

  if (result.length > 0) {
    logger.info('Project deleted', { projectId: id });
    return true;
  }

  return false;
}

/**
 * Enable or disable a project
 */
export async function setEnabled(id: string, enabled: boolean): Promise<boolean> {
  const db = getDatabase();

  const result = await db
    .update(projects)
    .set({ enabled, updatedAt: new Date() })
    .where(eq(projects.id, id))
    .returning({ id: projects.id });

  if (result.length > 0) {
    logger.info('Project status changed', { projectId: id, enabled });
    return true;
  }

  return false;
}

/**
 * Count total projects
 */
export async function count(includeDisabled = false): Promise<number> {
  const db = getDatabase();

  const result = includeDisabled
    ? await db.select().from(projects)
    : await db.select().from(projects).where(eq(projects.enabled, true));

  return result.length;
}
