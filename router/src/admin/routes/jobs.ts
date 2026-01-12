/**
 * Admin API routes for job history
 */

import { Router, Request, Response } from 'express';
import { jobHistoryRepo } from '../../db/repositories';
import { logger } from '../../logger';

export const jobsRouter = Router();

/**
 * GET /admin/api/jobs
 * List all jobs with pagination
 */
jobsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = parseInt(req.query.offset as string) || 0;
    const projectId = req.query.projectId as string | undefined;

    let jobs;
    let total;

    if (projectId) {
      jobs = await jobHistoryRepo.findByProject(projectId, { limit, offset });
      total = await jobHistoryRepo.count(projectId);
    } else {
      jobs = await jobHistoryRepo.findAll({ limit, offset });
      total = await jobHistoryRepo.count();
    }

    res.json({
      jobs,
      total,
      limit,
      offset,
      hasMore: offset + jobs.length < total,
    });
  } catch (error) {
    logger.error('Failed to list jobs', { error });
    res.status(500).json({ error: 'Failed to list jobs' });
  }
});

/**
 * GET /admin/api/jobs/stats
 * Get job statistics
 */
jobsRouter.get('/stats', async (req: Request, res: Response) => {
  try {
    const projectId = req.query.projectId as string | undefined;
    const stats = await jobHistoryRepo.getStats(projectId);

    res.json({ stats });
  } catch (error) {
    logger.error('Failed to get job stats', { error });
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

/**
 * GET /admin/api/jobs/:id
 * Get a single job by ID
 */
jobsRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const job = await jobHistoryRepo.findById(req.params.id);

    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }

    res.json({ job });
  } catch (error) {
    logger.error('Failed to get job', { error, id: req.params.id });
    res.status(500).json({ error: 'Failed to get job' });
  }
});

/**
 * DELETE /admin/api/jobs/cleanup
 * Clean up old job history
 */
jobsRouter.delete('/cleanup', async (req: Request, res: Response) => {
  try {
    // Default to 30 days if not specified
    const daysOld = parseInt(req.query.daysOld as string) || 30;
    const olderThan = new Date();
    olderThan.setDate(olderThan.getDate() - daysOld);

    const deleted = await jobHistoryRepo.cleanup(olderThan);

    logger.info('Job history cleanup via admin API', { deleted, daysOld });

    res.json({
      success: true,
      deleted,
      olderThan: olderThan.toISOString(),
    });
  } catch (error) {
    logger.error('Failed to cleanup jobs', { error });
    res.status(500).json({ error: 'Failed to cleanup jobs' });
  }
});

/**
 * GET /admin/api/jobs/by-trigger/:triggerType/:triggerId
 * Get jobs by trigger
 */
jobsRouter.get('/by-trigger/:triggerType/:triggerId', async (req: Request, res: Response) => {
  try {
    const { triggerType, triggerId } = req.params;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    const jobs = await jobHistoryRepo.findByTrigger(triggerType, triggerId, { limit, offset });

    res.json({
      jobs,
      triggerType,
      triggerId,
    });
  } catch (error) {
    logger.error('Failed to get jobs by trigger', { error });
    res.status(500).json({ error: 'Failed to get jobs' });
  }
});
