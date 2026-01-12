/**
 * Admin Dashboard view
 *
 * Shows overview stats and recent activity.
 */

import { Request, Response } from 'express';
import { renderLayout, escapeHtml } from './layout';
import { projectsRepo, jobHistoryRepo } from '../../db/repositories';

/**
 * Render the dashboard page
 */
export async function renderDashboard(req: Request, res: Response): Promise<void> {
  try {
    // Fetch stats in parallel
    const [projects, jobStats] = await Promise.all([
      projectsRepo.findAll(true),
      jobHistoryRepo.getStats(),
    ]);

    const activeProjects = projects.filter(p => p.enabled).length;

    // Get recent jobs
    const recentJobs = await jobHistoryRepo.findAll({ limit: 5, offset: 0 });

    const content = `
      <div class="page-header">
        <h1 class="page-title">Dashboard</h1>
        <p class="page-subtitle">Overview of your AI Bug Fixer system</p>
      </div>

      <div class="grid grid-4 mb-4">
        <div class="card">
          <div class="stat">
            <div class="stat-value">${activeProjects}</div>
            <div class="stat-label">Active Projects</div>
          </div>
        </div>
        <div class="card">
          <div class="stat">
            <div class="stat-value">${jobStats.total || 0}</div>
            <div class="stat-label">Total Jobs</div>
          </div>
        </div>
        <div class="card">
          <div class="stat">
            <div class="stat-value">${jobStats.fixedCount || 0}</div>
            <div class="stat-label">Bugs Fixed</div>
          </div>
        </div>
        <div class="card">
          <div class="stat">
            <div class="stat-value">${calculateSuccessRate(jobStats)}%</div>
            <div class="stat-label">Success Rate</div>
          </div>
        </div>
      </div>

      <div class="grid grid-2">
        <div class="card">
          <div class="flex justify-between items-center mb-4">
            <h2 class="card-title">Recent Jobs</h2>
            <a href="/admin/jobs" class="btn btn-ghost">View all</a>
          </div>
          ${renderRecentJobs(recentJobs)}
        </div>

        <div class="card">
          <div class="flex justify-between items-center mb-4">
            <h2 class="card-title">Projects</h2>
            <a href="/admin/projects" class="btn btn-ghost">Manage</a>
          </div>
          ${renderProjectsList(projects.slice(0, 5))}
        </div>
      </div>

      <div class="card mt-4">
        <h2 class="card-title">Quick Actions</h2>
        <div class="flex gap-4 mt-4">
          <a href="/admin/projects/new" class="btn btn-primary">Add Project</a>
          <a href="/admin/settings" class="btn btn-secondary">Configure Settings</a>
          <a href="/admin/api/export/all" class="btn btn-ghost">Export Backup</a>
        </div>
      </div>
    `;

    res.send(renderLayout(content, { title: 'Dashboard', activeNav: 'dashboard' }));
  } catch (error) {
    res.status(500).send(renderLayout(renderError(error), { title: 'Dashboard Error' }));
  }
}

function calculateSuccessRate(stats: { total?: number; fixedCount?: number }): number {
  if (!stats.total || stats.total === 0) return 0;
  return Math.round(((stats.fixedCount || 0) / stats.total) * 100);
}

function renderRecentJobs(jobs: Array<{
  jobId: string;
  projectId: string;
  triggerType: string;
  status: string;
  fixed: boolean | null;
  startedAt: Date | null;
}>): string {
  if (jobs.length === 0) {
    return `
      <div class="empty-state">
        <div class="empty-state-icon">&#128270;</div>
        <div class="empty-state-title">No jobs yet</div>
        <div class="empty-state-text">Jobs will appear here once your triggers fire.</div>
      </div>
    `;
  }

  return `
    <table class="table">
      <thead>
        <tr>
          <th>Project</th>
          <th>Trigger</th>
          <th>Status</th>
          <th>Time</th>
        </tr>
      </thead>
      <tbody>
        ${jobs.map(job => `
          <tr>
            <td><code>${escapeHtml(job.projectId)}</code></td>
            <td>${escapeHtml(job.triggerType)}</td>
            <td>${renderJobStatus(job.status, job.fixed)}</td>
            <td class="text-muted">${job.startedAt ? formatRelativeTime(job.startedAt) : 'Queued'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function renderProjectsList(projects: Array<{
  id: string;
  repoFullName: string;
  enabled: boolean;
}>): string {
  if (projects.length === 0) {
    return `
      <div class="empty-state">
        <div class="empty-state-icon">&#128230;</div>
        <div class="empty-state-title">No projects yet</div>
        <div class="empty-state-text">Add your first repository to start fixing bugs.</div>
        <a href="/admin/projects/new" class="btn btn-primary">Add Project</a>
      </div>
    `;
  }

  return `
    <table class="table">
      <thead>
        <tr>
          <th>Repository</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${projects.map(project => `
          <tr>
            <td>
              <a href="/admin/projects/${escapeHtml(project.id)}" class="nav-link">
                ${escapeHtml(project.repoFullName)}
              </a>
            </td>
            <td>
              ${project.enabled
                ? '<span class="badge badge-success">Active</span>'
                : '<span class="badge badge-warning">Disabled</span>'
              }
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function renderJobStatus(status: string, fixed: boolean | null): string {
  if (status === 'success') {
    return fixed
      ? '<span class="badge badge-success">Fixed</span>'
      : '<span class="badge badge-info">Analyzed</span>';
  }
  if (status === 'failed') {
    return '<span class="badge badge-error">Failed</span>';
  }
  if (status === 'running') {
    return '<span class="badge badge-info"><span class="status-dot running"></span> Running</span>';
  }
  return `<span class="badge">${escapeHtml(status)}</span>`;
}

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

function renderError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'An error occurred';
  return `
    <div class="card">
      <div class="empty-state">
        <div class="empty-state-icon">&#9888;</div>
        <div class="empty-state-title">Error loading dashboard</div>
        <div class="empty-state-text">${escapeHtml(message)}</div>
        <a href="/admin" class="btn btn-primary">Retry</a>
      </div>
    </div>
  `;
}
