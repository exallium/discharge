/**
 * Admin Jobs view
 *
 * Display job history and statistics.
 */

import { Request, Response } from 'express';
import { renderLayout, escapeHtml } from './layout';
import { jobHistoryRepo, projectsRepo } from '../../db/repositories';

/**
 * Render the jobs list page
 */
export async function renderJobsList(req: Request, res: Response): Promise<void> {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = 20;
    const offset = (page - 1) * limit;
    const projectId = req.query.projectId as string | undefined;

    // Fetch jobs and stats
    const [jobs, total, stats, projects] = await Promise.all([
      projectId
        ? jobHistoryRepo.findByProject(projectId, { limit, offset })
        : jobHistoryRepo.findAll({ limit, offset }),
      jobHistoryRepo.count(projectId),
      jobHistoryRepo.getStats(projectId),
      projectsRepo.findAll(false),
    ]);

    const totalPages = Math.ceil(total / limit);

    const content = `
      <div class="page-header flex justify-between items-center">
        <div>
          <h1 class="page-title">Job History</h1>
          <p class="page-subtitle">Track AI bug fixing attempts</p>
        </div>
        <button class="btn btn-secondary" onclick="cleanupJobs()">Cleanup Old Jobs</button>
      </div>

      <div class="grid grid-4 mb-4">
        <div class="card">
          <div class="stat">
            <div class="stat-value">${stats.total || 0}</div>
            <div class="stat-label">Total Jobs</div>
          </div>
        </div>
        <div class="card">
          <div class="stat">
            <div class="stat-value">${stats.success || 0}</div>
            <div class="stat-label">Completed</div>
          </div>
        </div>
        <div class="card">
          <div class="stat">
            <div class="stat-value">${stats.fixedCount || 0}</div>
            <div class="stat-label">Bugs Fixed</div>
          </div>
        </div>
        <div class="card">
          <div class="stat">
            <div class="stat-value">${stats.failed || 0}</div>
            <div class="stat-label">Failed</div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="flex justify-between items-center mb-4">
          <div class="flex gap-2 items-center">
            <label class="form-label" style="margin: 0;">Filter by project:</label>
            <select class="form-input" style="width: auto;" onchange="filterByProject(this.value)">
              <option value="">All Projects</option>
              ${projects.map(p => `
                <option value="${escapeHtml(p.id)}" ${projectId === p.id ? 'selected' : ''}>
                  ${escapeHtml(p.repoFullName)}
                </option>
              `).join('')}
            </select>
          </div>
          <div class="text-muted">
            Showing ${offset + 1}-${Math.min(offset + jobs.length, total)} of ${total}
          </div>
        </div>

        ${jobs.length === 0 ? renderEmptyState() : renderJobsTable(jobs)}

        ${totalPages > 1 ? renderPagination(page, totalPages, projectId) : ''}
      </div>
    `;

    const script = `
      function filterByProject(projectId) {
        const url = new URL(window.location.href);
        if (projectId) {
          url.searchParams.set('projectId', projectId);
        } else {
          url.searchParams.delete('projectId');
        }
        url.searchParams.delete('page');
        window.location.href = url.toString();
      }

      async function cleanupJobs() {
        const daysOld = prompt('Delete jobs older than how many days?', '30');
        if (!daysOld) return;

        try {
          const result = await api('DELETE', '/jobs/cleanup?daysOld=' + daysOld);
          showToast('Deleted ' + result.deleted + ' old jobs', 'success');
          setTimeout(() => location.reload(), 1000);
        } catch (error) {
          showToast(error.message, 'error');
        }
      }

      async function viewJob(jobId) {
        try {
          const result = await api('GET', '/jobs/' + jobId);
          const job = result.job;
          const modal = document.createElement('div');
          modal.className = 'modal-backdrop';
          modal.innerHTML = \`
            <div class="modal" style="max-width: 700px;">
              <h2 class="modal-title">Job Details</h2>
              <div class="form-group">
                <label class="form-label">Job ID</label>
                <code>\${job.jobId}</code>
              </div>
              <div class="form-group">
                <label class="form-label">Project</label>
                <div>\${job.projectId}</div>
              </div>
              <div class="form-group">
                <label class="form-label">Trigger</label>
                <div>\${job.triggerType} (\${job.triggerId || 'N/A'})</div>
              </div>
              <div class="form-group">
                <label class="form-label">Status</label>
                <div>\${job.status} \${job.fixed ? '(Fixed)' : ''}</div>
              </div>
              \${job.prUrl ? \`
                <div class="form-group">
                  <label class="form-label">Pull Request</label>
                  <a href="\${job.prUrl}" target="_blank" class="nav-link">\${job.prUrl}</a>
                </div>
              \` : ''}
              \${job.error ? \`
                <div class="form-group">
                  <label class="form-label">Error</label>
                  <div class="text-error">\${job.error}</div>
                </div>
              \` : ''}
              \${job.analysis ? \`
                <div class="form-group">
                  <label class="form-label">Analysis</label>
                  <pre style="background: var(--md-surface-2); padding: var(--space-3); border-radius: var(--radius-md); overflow: auto; max-height: 200px;">\${JSON.stringify(job.analysis, null, 2)}</pre>
                </div>
              \` : ''}
              <div class="modal-actions">
                <button class="btn btn-ghost" onclick="this.closest('.modal-backdrop').remove()">Close</button>
              </div>
            </div>
          \`;
          document.body.appendChild(modal);
          modal.addEventListener('click', function(e) {
            if (e.target === modal) modal.remove();
          });
        } catch (error) {
          showToast(error.message, 'error');
        }
      }
    `;

    res.send(renderLayout(content, { title: 'Jobs', activeNav: 'jobs', scripts: [script] }));
  } catch (error) {
    res.status(500).send(renderLayout(renderError(error), { title: 'Jobs Error' }));
  }
}

function renderEmptyState(): string {
  return `
    <div class="empty-state">
      <div class="empty-state-icon">&#128270;</div>
      <div class="empty-state-title">No jobs yet</div>
      <div class="empty-state-text">Jobs will appear here once your triggers fire.</div>
    </div>
  `;
}

function renderJobsTable(jobs: Array<{
  jobId: string;
  projectId: string;
  triggerType: string;
  triggerId?: string | null;
  status: string;
  fixed: boolean | null;
  prUrl?: string | null;
  startedAt: Date | null;
  completedAt?: Date | null;
}>): string {
  return `
    <table class="table">
      <thead>
        <tr>
          <th>Job ID</th>
          <th>Project</th>
          <th>Trigger</th>
          <th>Status</th>
          <th>Duration</th>
          <th>Started</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${jobs.map(job => `
          <tr>
            <td><code style="font-size: 0.75rem;">${escapeHtml(job.jobId.slice(0, 8))}...</code></td>
            <td>${escapeHtml(job.projectId)}</td>
            <td>
              <span class="badge badge-info">${escapeHtml(job.triggerType)}</span>
              ${job.triggerId ? `<span class="text-muted">#${escapeHtml(job.triggerId)}</span>` : ''}
            </td>
            <td>${renderJobStatus(job.status, job.fixed, job.prUrl)}</td>
            <td class="text-muted">${formatDuration(job.startedAt, job.completedAt)}</td>
            <td class="text-muted">${formatDate(job.startedAt)}</td>
            <td>
              <button class="btn btn-ghost" onclick="viewJob('${escapeHtml(job.jobId)}')">View</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function renderJobStatus(status: string, fixed: boolean | null, prUrl?: string | null): string {
  if (status === 'success') {
    if (fixed && prUrl) {
      return `<a href="${escapeHtml(prUrl)}" target="_blank" class="badge badge-success">Fixed (PR)</a>`;
    }
    if (fixed) {
      return '<span class="badge badge-success">Fixed</span>';
    }
    return '<span class="badge badge-info">Analyzed</span>';
  }
  if (status === 'failed') {
    return '<span class="badge badge-error">Failed</span>';
  }
  if (status === 'running') {
    return '<span class="badge badge-info"><span class="status-dot running"></span> Running</span>';
  }
  if (status === 'pending') {
    return '<span class="badge">Queued</span>';
  }
  return `<span class="badge">${escapeHtml(status)}</span>`;
}

function renderPagination(currentPage: number, totalPages: number, projectId?: string): string {
  const pages: string[] = [];
  const baseUrl = projectId ? `/admin/jobs?projectId=${escapeHtml(projectId)}&` : '/admin/jobs?';

  // Previous button
  if (currentPage > 1) {
    pages.push(`<a href="${baseUrl}page=${currentPage - 1}" class="btn btn-ghost">&laquo; Previous</a>`);
  }

  // Page numbers
  for (let i = 1; i <= totalPages; i++) {
    if (i === currentPage) {
      pages.push(`<span class="btn btn-primary">${i}</span>`);
    } else if (i === 1 || i === totalPages || (i >= currentPage - 2 && i <= currentPage + 2)) {
      pages.push(`<a href="${baseUrl}page=${i}" class="btn btn-ghost">${i}</a>`);
    } else if (i === currentPage - 3 || i === currentPage + 3) {
      pages.push('<span class="text-muted">...</span>');
    }
  }

  // Next button
  if (currentPage < totalPages) {
    pages.push(`<a href="${baseUrl}page=${currentPage + 1}" class="btn btn-ghost">Next &raquo;</a>`);
  }

  return `
    <div class="flex justify-between items-center mt-4" style="padding-top: var(--space-4); border-top: 1px solid var(--md-outline-variant);">
      <div></div>
      <div class="flex gap-2 items-center">
        ${pages.join('')}
      </div>
    </div>
  `;
}

function formatDuration(start: Date | null, end?: Date | null): string {
  if (!start) return 'Pending';
  if (!end) return 'In progress';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

function formatDate(date: Date | null): string {
  if (!date) return 'Pending';
  return new Date(date).toLocaleString();
}

function renderError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'An error occurred';
  return `
    <div class="card">
      <div class="empty-state">
        <div class="empty-state-icon">&#9888;</div>
        <div class="empty-state-title">Error loading jobs</div>
        <div class="empty-state-text">${escapeHtml(message)}</div>
        <a href="/admin/jobs" class="btn btn-primary">Retry</a>
      </div>
    </div>
  `;
}
