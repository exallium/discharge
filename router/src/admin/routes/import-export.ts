/**
 * Admin API routes for import/export functionality
 */

import { Router, Request, Response } from 'express';
import { projectsRepo, settingsRepo, auditLogRepo } from '../../db/repositories';
import { getAdminUser } from '../auth';
import { logger } from '../../logger';

export const importExportRouter = Router();

/**
 * GET /admin/api/export/projects
 * Export all projects as JSON
 */
importExportRouter.get('/projects', async (req: Request, res: Response) => {
  try {
    const includeDisabled = req.query.includeDisabled === 'true';
    const projects = await projectsRepo.findAll(includeDisabled);

    // Audit log
    await auditLogRepo.log('export.projects', { type: 'export' }, {
      actor: getAdminUser(req),
      ipAddress: req.ip,
    });

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="projects.json"');

    res.json({
      version: '1.0',
      exportedAt: new Date().toISOString(),
      projects,
    });
  } catch (error) {
    logger.error('Failed to export projects', { error });
    res.status(500).json({ error: 'Failed to export projects' });
  }
});

/**
 * POST /admin/api/import/projects
 * Import projects from JSON
 */
importExportRouter.post('/projects', async (req: Request, res: Response) => {
  try {
    const { projects, mode = 'merge' } = req.body;

    if (!Array.isArray(projects)) {
      res.status(400).json({ error: 'projects must be an array' });
      return;
    }

    const results = {
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [] as string[],
    };

    for (const project of projects) {
      try {
        if (!project.id || !project.repo || !project.repoFullName || !project.vcs) {
          results.errors.push(`Invalid project: missing required fields (id: ${project.id})`);
          results.skipped++;
          continue;
        }

        const existing = await projectsRepo.findById(project.id);

        if (existing) {
          if (mode === 'skip') {
            results.skipped++;
            continue;
          }

          // Update existing
          await projectsRepo.update(project.id, {
            repo: project.repo,
            repoFullName: project.repoFullName,
            branch: project.branch || 'main',
            vcs: project.vcs,
            runner: project.runner,
            triggers: project.triggers || {},
            constraints: project.constraints,
            enabled: project.enabled ?? true,
          });
          results.updated++;
        } else {
          // Create new
          await projectsRepo.create({
            id: project.id,
            repo: project.repo,
            repoFullName: project.repoFullName,
            branch: project.branch || 'main',
            vcs: project.vcs,
            runner: project.runner,
            triggers: project.triggers || {},
            constraints: project.constraints,
            enabled: project.enabled ?? true,
          });
          results.created++;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.errors.push(`Failed to import project ${project.id}: ${message}`);
        results.skipped++;
      }
    }

    // Audit log
    await auditLogRepo.log('import.projects', { type: 'import' }, {
      changes: {
        after: {
          created: results.created,
          updated: results.updated,
          skipped: results.skipped,
        },
      },
      actor: getAdminUser(req),
      ipAddress: req.ip,
    });

    logger.info('Projects imported via admin API', results);

    res.json({
      success: true,
      results,
    });
  } catch (error) {
    logger.error('Failed to import projects', { error });
    res.status(500).json({ error: 'Failed to import projects' });
  }
});

/**
 * GET /admin/api/export/settings
 * Export settings (secrets are masked)
 */
importExportRouter.get('/settings', async (req: Request, res: Response) => {
  try {
    const settings = await settingsRepo.getAll();

    // Audit log
    await auditLogRepo.log('export.settings', { type: 'export' }, {
      actor: getAdminUser(req),
      ipAddress: req.ip,
    });

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="settings.json"');

    res.json({
      version: '1.0',
      exportedAt: new Date().toISOString(),
      note: 'Encrypted values are masked and must be re-entered after import',
      settings,
    });
  } catch (error) {
    logger.error('Failed to export settings', { error });
    res.status(500).json({ error: 'Failed to export settings' });
  }
});

/**
 * GET /admin/api/export/all
 * Export everything (projects + settings) for backup
 */
importExportRouter.get('/all', async (req: Request, res: Response) => {
  try {
    const includeDisabled = req.query.includeDisabled === 'true';
    const projects = await projectsRepo.findAll(includeDisabled);
    const settings = await settingsRepo.getAll();

    // Audit log
    await auditLogRepo.log('export.all', { type: 'export' }, {
      actor: getAdminUser(req),
      ipAddress: req.ip,
    });

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="ai-bug-fixer-backup.json"');

    res.json({
      version: '1.0',
      exportedAt: new Date().toISOString(),
      note: 'Encrypted values are masked and must be re-entered after import',
      projects,
      settings,
    });
  } catch (error) {
    logger.error('Failed to export all', { error });
    res.status(500).json({ error: 'Failed to export' });
  }
});
