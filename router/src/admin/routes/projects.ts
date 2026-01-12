/**
 * Admin API routes for project management
 */

import { Router, Request, Response } from 'express';
import { projectsRepo, auditLogRepo } from '../../db/repositories';
import { getAdminUser } from '../auth';
import { logger } from '../../logger';

export const projectsRouter = Router();

/**
 * GET /admin/api/projects
 * List all projects
 */
projectsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const includeDisabled = req.query.includeDisabled === 'true';
    const projects = await projectsRepo.findAll(includeDisabled);

    res.json({
      projects,
      total: projects.length,
    });
  } catch (error) {
    logger.error('Failed to list projects', { error });
    res.status(500).json({ error: 'Failed to list projects' });
  }
});

/**
 * GET /admin/api/projects/:id
 * Get a single project by ID
 */
projectsRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const project = await projectsRepo.findById(req.params.id);

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    res.json({ project });
  } catch (error) {
    logger.error('Failed to get project', { error, id: req.params.id });
    res.status(500).json({ error: 'Failed to get project' });
  }
});

/**
 * POST /admin/api/projects
 * Create a new project
 */
projectsRouter.post('/', async (req: Request, res: Response) => {
  try {
    const {
      id,
      repo,
      repoFullName,
      branch,
      vcs,
      runner,
      triggers,
      constraints,
      enabled,
    } = req.body;

    // Validate required fields
    if (!id || !repo || !repoFullName || !vcs) {
      res.status(400).json({
        error: 'Missing required fields',
        required: ['id', 'repo', 'repoFullName', 'vcs'],
      });
      return;
    }

    // Check for duplicate ID
    const existing = await projectsRepo.findById(id);
    if (existing) {
      res.status(409).json({ error: 'Project with this ID already exists' });
      return;
    }

    // Create project
    const project = await projectsRepo.create({
      id,
      repo,
      repoFullName,
      branch: branch || 'main',
      vcs,
      runner,
      triggers: triggers || {},
      constraints,
      enabled,
    });

    // Audit log
    await auditLogRepo.logProjectChange('create', id, {
      after: project as unknown as Record<string, unknown>,
      actor: getAdminUser(req),
      ipAddress: req.ip,
    });

    logger.info('Project created via admin API', { projectId: id });

    res.status(201).json({ project });
  } catch (error) {
    logger.error('Failed to create project', { error });
    res.status(500).json({ error: 'Failed to create project' });
  }
});

/**
 * PUT /admin/api/projects/:id
 * Update a project
 */
projectsRouter.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Get existing project for audit log
    const existing = await projectsRepo.findById(id);
    if (!existing) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    // Update project
    const project = await projectsRepo.update(id, updates);

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    // Audit log
    await auditLogRepo.logProjectChange('update', id, {
      before: existing as unknown as Record<string, unknown>,
      after: project as unknown as Record<string, unknown>,
      actor: getAdminUser(req),
      ipAddress: req.ip,
    });

    logger.info('Project updated via admin API', { projectId: id });

    res.json({ project });
  } catch (error) {
    logger.error('Failed to update project', { error, id: req.params.id });
    res.status(500).json({ error: 'Failed to update project' });
  }
});

/**
 * DELETE /admin/api/projects/:id
 * Delete a project
 */
projectsRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Get existing project for audit log
    const existing = await projectsRepo.findById(id);
    if (!existing) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const deleted = await projectsRepo.remove(id);

    if (!deleted) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    // Audit log
    await auditLogRepo.logProjectChange('delete', id, {
      before: existing as unknown as Record<string, unknown>,
      actor: getAdminUser(req),
      ipAddress: req.ip,
    });

    logger.info('Project deleted via admin API', { projectId: id });

    res.json({ success: true, id });
  } catch (error) {
    logger.error('Failed to delete project', { error, id: req.params.id });
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

/**
 * POST /admin/api/projects/:id/toggle
 * Enable or disable a project
 */
projectsRouter.post('/:id/toggle', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'enabled must be a boolean' });
      return;
    }

    const success = await projectsRepo.setEnabled(id, enabled);

    if (!success) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    // Audit log
    await auditLogRepo.logProjectChange(enabled ? 'enable' : 'disable', id, {
      actor: getAdminUser(req),
      ipAddress: req.ip,
    });

    logger.info('Project toggled via admin API', { projectId: id, enabled });

    res.json({ success: true, id, enabled });
  } catch (error) {
    logger.error('Failed to toggle project', { error, id: req.params.id });
    res.status(500).json({ error: 'Failed to toggle project' });
  }
});
