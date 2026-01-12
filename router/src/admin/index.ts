/**
 * Admin router
 *
 * Provides admin API and UI for managing projects, settings, and viewing job history.
 */

import { Router } from 'express';
import { adminAuth, requireAdminSetup } from './auth';
import { projectsRouter } from './routes/projects';
import { settingsRouter } from './routes/settings';
import { jobsRouter } from './routes/jobs';
import { importExportRouter } from './routes/import-export';
import {
  renderDashboard,
  renderProjectsList,
  renderNewProject,
  renderEditProject,
  renderSettings,
  renderJobsList,
  renderSetup,
} from './views';

export const adminRouter = Router();

// Setup wizard is accessible without auth (for first-run)
adminRouter.get('/setup', renderSetup);

// All other routes require authentication
adminRouter.use(requireAdminSetup);
adminRouter.use(adminAuth);

// API routes
adminRouter.use('/api/projects', projectsRouter);
adminRouter.use('/api/settings', settingsRouter);
adminRouter.use('/api/jobs', jobsRouter);
adminRouter.use('/api/export', importExportRouter);
adminRouter.use('/api/import', importExportRouter);

// UI routes
adminRouter.get('/', (req, res) => {
  res.redirect('/admin/dashboard');
});

adminRouter.get('/dashboard', renderDashboard);
adminRouter.get('/projects', renderProjectsList);
adminRouter.get('/projects/new', renderNewProject);
adminRouter.get('/projects/:id', renderEditProject);
adminRouter.get('/settings', renderSettings);
adminRouter.get('/jobs', renderJobsList);

// Re-export auth utilities
export { adminAuth, requireAdminSetup, getAdminUser } from './auth';
