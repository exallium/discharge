/**
 * Admin Projects views
 *
 * List, create, and edit project configurations.
 */

import { Request, Response } from 'express';
import { renderLayout, escapeHtml } from './layout';
import { projectsRepo } from '../../db/repositories';

/**
 * Render the projects list page
 */
export async function renderProjectsList(req: Request, res: Response): Promise<void> {
  try {
    const includeDisabled = req.query.includeDisabled === 'true';
    const projects = await projectsRepo.findAll(includeDisabled);

    const content = `
      <div class="page-header flex justify-between items-center">
        <div>
          <h1 class="page-title">Projects</h1>
          <p class="page-subtitle">Manage your repository configurations</p>
        </div>
        <a href="/admin/projects/new" class="btn btn-primary">+ Add Project</a>
      </div>

      <div class="card">
        <div class="flex justify-between items-center mb-4">
          <div class="flex gap-2">
            <label class="flex items-center gap-2">
              <input type="checkbox" id="includeDisabled" ${includeDisabled ? 'checked' : ''}>
              <span class="text-muted">Show disabled</span>
            </label>
          </div>
        </div>

        ${projects.length === 0 ? renderEmptyState() : renderProjectsTable(projects)}
      </div>
    `;

    const script = `
      document.getElementById('includeDisabled').addEventListener('change', function() {
        window.location.href = '/admin/projects' + (this.checked ? '?includeDisabled=true' : '');
      });
    `;

    res.send(renderLayout(content, { title: 'Projects', activeNav: 'projects', scripts: [script] }));
  } catch (error) {
    res.status(500).send(renderLayout(renderError(error), { title: 'Projects Error' }));
  }
}

/**
 * Render the new project form
 */
export async function renderNewProject(req: Request, res: Response): Promise<void> {
  const content = `
    <div class="page-header">
      <h1 class="page-title">Add Project</h1>
      <p class="page-subtitle">Configure a new repository for AI bug fixing</p>
    </div>

    <div class="card">
      <form id="projectForm" class="form">
        <div class="form-group">
          <label class="form-label" for="id">Project ID</label>
          <input class="form-input" type="text" id="id" name="id" required
                 placeholder="my-project" pattern="[a-z0-9-]+"
                 title="Lowercase letters, numbers, and hyphens only">
          <p class="form-help">Unique identifier for this project (lowercase, hyphens allowed)</p>
        </div>

        <div class="form-group">
          <label class="form-label" for="repoFullName">Repository</label>
          <input class="form-input" type="text" id="repoFullName" name="repoFullName" required
                 placeholder="owner/repo">
          <p class="form-help">Full repository name (e.g., myorg/my-repo)</p>
        </div>

        <div class="form-group">
          <label class="form-label" for="repo">Clone URL</label>
          <input class="form-input" type="text" id="repo" name="repo" required
                 placeholder="https://github.com/owner/repo.git">
          <p class="form-help">URL used to clone the repository</p>
        </div>

        <div class="form-group">
          <label class="form-label" for="branch">Default Branch</label>
          <input class="form-input" type="text" id="branch" name="branch" value="main"
                 placeholder="main">
        </div>

        <div class="form-group">
          <label class="form-label" for="vcsType">VCS Provider</label>
          <select class="form-input" id="vcsType" name="vcsType" required>
            <option value="github">GitHub</option>
          </select>
        </div>

        <div class="form-group">
          <label class="form-label" for="runnerType">Runner</label>
          <select class="form-input" id="runnerType" name="runnerType" required>
            <option value="claude-code">Claude Code</option>
          </select>
        </div>

        <div class="form-group">
          <label class="form-label">Triggers</label>
          <div class="flex flex-col gap-2 mt-2">
            <label class="flex items-center gap-2">
              <input type="checkbox" name="triggers" value="github-issues">
              <span>GitHub Issues</span>
            </label>
            <label class="flex items-center gap-2">
              <input type="checkbox" name="triggers" value="sentry">
              <span>Sentry Errors</span>
            </label>
            <label class="flex items-center gap-2">
              <input type="checkbox" name="triggers" value="circleci">
              <span>CircleCI Failures</span>
            </label>
          </div>
        </div>

        <div class="flex gap-2 mt-4">
          <button type="submit" class="btn btn-primary">Create Project</button>
          <a href="/admin/projects" class="btn btn-ghost">Cancel</a>
        </div>
      </form>
    </div>
  `;

  const script = `
    document.getElementById('projectForm').addEventListener('submit', async function(e) {
      e.preventDefault();

      const form = e.target;
      const triggers = Array.from(form.querySelectorAll('input[name="triggers"]:checked'))
        .map(input => input.value);

      const data = {
        id: form.id.value,
        repo: form.repo.value,
        repoFullName: form.repoFullName.value,
        branch: form.branch.value || 'main',
        vcs: { type: form.vcsType.value },
        runner: { type: form.runnerType.value },
        triggers: triggers.reduce((acc, t) => ({ ...acc, [t]: {} }), {}),
        enabled: true,
      };

      try {
        await api('POST', '/projects', data);
        showToast('Project created successfully', 'success');
        setTimeout(() => window.location.href = '/admin/projects', 1000);
      } catch (error) {
        showToast(error.message, 'error');
      }
    });

    // Auto-fill repo URL from full name
    document.getElementById('repoFullName').addEventListener('blur', function() {
      const repoInput = document.getElementById('repo');
      if (!repoInput.value && this.value) {
        repoInput.value = 'https://github.com/' + this.value + '.git';
      }
    });
  `;

  res.send(renderLayout(content, { title: 'Add Project', activeNav: 'projects', scripts: [script] }));
}

/**
 * Render the edit project form
 */
export async function renderEditProject(req: Request, res: Response): Promise<void> {
  try {
    const project = await projectsRepo.findById(req.params.id);

    if (!project) {
      res.status(404).send(renderLayout(renderNotFound(), { title: 'Project Not Found' }));
      return;
    }

    const triggers = project.triggers as Record<string, unknown>;
    const vcs = project.vcs as { type: string };
    const runner = project.runner as { type: string } | undefined;

    const content = `
      <div class="page-header">
        <h1 class="page-title">Edit Project</h1>
        <p class="page-subtitle">${escapeHtml(project.repoFullName)}</p>
      </div>

      <div class="card">
        <form id="projectForm" class="form">
          <div class="form-group">
            <label class="form-label">Project ID</label>
            <input class="form-input" type="text" value="${escapeHtml(project.id)}" disabled>
            <p class="form-help">Project ID cannot be changed</p>
          </div>

          <div class="form-group">
            <label class="form-label" for="repoFullName">Repository</label>
            <input class="form-input" type="text" id="repoFullName" name="repoFullName" required
                   value="${escapeHtml(project.repoFullName)}">
          </div>

          <div class="form-group">
            <label class="form-label" for="repo">Clone URL</label>
            <input class="form-input" type="text" id="repo" name="repo" required
                   value="${escapeHtml(project.repo)}">
          </div>

          <div class="form-group">
            <label class="form-label" for="branch">Default Branch</label>
            <input class="form-input" type="text" id="branch" name="branch"
                   value="${escapeHtml(project.branch)}">
          </div>

          <div class="form-group">
            <label class="form-label" for="vcsType">VCS Provider</label>
            <select class="form-input" id="vcsType" name="vcsType" required>
              <option value="github" ${vcs.type === 'github' ? 'selected' : ''}>GitHub</option>
            </select>
          </div>

          <div class="form-group">
            <label class="form-label" for="runnerType">Runner</label>
            <select class="form-input" id="runnerType" name="runnerType" required>
              <option value="claude-code" ${runner?.type === 'claude-code' ? 'selected' : ''}>Claude Code</option>
            </select>
          </div>

          <div class="form-group">
            <label class="form-label">Triggers</label>
            <div class="flex flex-col gap-2 mt-2">
              <label class="flex items-center gap-2">
                <input type="checkbox" name="triggers" value="github-issues"
                       ${triggers['github-issues'] !== undefined ? 'checked' : ''}>
                <span>GitHub Issues</span>
              </label>
              <label class="flex items-center gap-2">
                <input type="checkbox" name="triggers" value="sentry"
                       ${triggers['sentry'] !== undefined ? 'checked' : ''}>
                <span>Sentry Errors</span>
              </label>
              <label class="flex items-center gap-2">
                <input type="checkbox" name="triggers" value="circleci"
                       ${triggers['circleci'] !== undefined ? 'checked' : ''}>
                <span>CircleCI Failures</span>
              </label>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label flex items-center gap-2">
              <input type="checkbox" id="enabled" name="enabled" ${project.enabled ? 'checked' : ''}>
              <span>Enabled</span>
            </label>
            <p class="form-help">Disabled projects won't process any triggers</p>
          </div>

          <div class="flex gap-2 mt-4">
            <button type="submit" class="btn btn-primary">Save Changes</button>
            <a href="/admin/projects" class="btn btn-ghost">Cancel</a>
            <button type="button" id="deleteBtn" class="btn btn-danger" style="margin-left: auto;">Delete</button>
          </div>
        </form>
      </div>
    `;

    const script = `
      const projectId = '${escapeHtml(project.id)}';

      document.getElementById('projectForm').addEventListener('submit', async function(e) {
        e.preventDefault();

        const form = e.target;
        const triggers = Array.from(form.querySelectorAll('input[name="triggers"]:checked'))
          .map(input => input.value);

        const data = {
          repo: form.repo.value,
          repoFullName: form.repoFullName.value,
          branch: form.branch.value || 'main',
          vcs: { type: form.vcsType.value },
          runner: { type: form.runnerType.value },
          triggers: triggers.reduce((acc, t) => ({ ...acc, [t]: {} }), {}),
          enabled: form.enabled.checked,
        };

        try {
          await api('PUT', '/projects/' + projectId, data);
          showToast('Project updated successfully', 'success');
        } catch (error) {
          showToast(error.message, 'error');
        }
      });

      document.getElementById('deleteBtn').addEventListener('click', async function() {
        if (confirm('Are you sure you want to delete this project? This cannot be undone.')) {
          try {
            await api('DELETE', '/projects/' + projectId);
            showToast('Project deleted', 'success');
            setTimeout(() => window.location.href = '/admin/projects', 1000);
          } catch (error) {
            showToast(error.message, 'error');
          }
        }
      });
    `;

    res.send(renderLayout(content, { title: 'Edit Project', activeNav: 'projects', scripts: [script] }));
  } catch (error) {
    res.status(500).send(renderLayout(renderError(error), { title: 'Project Error' }));
  }
}

function renderEmptyState(): string {
  return `
    <div class="empty-state">
      <div class="empty-state-icon">&#128230;</div>
      <div class="empty-state-title">No projects yet</div>
      <div class="empty-state-text">Add your first repository to start automatically fixing bugs.</div>
      <a href="/admin/projects/new" class="btn btn-primary">+ Add Project</a>
    </div>
  `;
}

function renderProjectsTable(projects: Array<{
  id: string;
  repo: string;
  repoFullName: string;
  branch: string;
  enabled: boolean;
  triggers: unknown;
  createdAt: Date;
}>): string {
  return `
    <table class="table">
      <thead>
        <tr>
          <th>Repository</th>
          <th>Branch</th>
          <th>Triggers</th>
          <th>Status</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${projects.map(project => {
          const triggers = project.triggers as Record<string, unknown>;
          const triggerCount = Object.keys(triggers).length;
          return `
            <tr>
              <td>
                <div><strong>${escapeHtml(project.repoFullName)}</strong></div>
                <div class="text-muted" style="font-size: 0.75rem;">${escapeHtml(project.id)}</div>
              </td>
              <td><code>${escapeHtml(project.branch)}</code></td>
              <td>${triggerCount} trigger${triggerCount !== 1 ? 's' : ''}</td>
              <td>
                ${project.enabled
                  ? '<span class="badge badge-success">Active</span>'
                  : '<span class="badge badge-warning">Disabled</span>'
                }
              </td>
              <td>
                <a href="/admin/projects/${escapeHtml(project.id)}" class="btn btn-ghost">Edit</a>
              </td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
}

function renderNotFound(): string {
  return `
    <div class="card">
      <div class="empty-state">
        <div class="empty-state-icon">&#128270;</div>
        <div class="empty-state-title">Project not found</div>
        <div class="empty-state-text">The project you're looking for doesn't exist.</div>
        <a href="/admin/projects" class="btn btn-primary">Back to Projects</a>
      </div>
    </div>
  `;
}

function renderError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'An error occurred';
  return `
    <div class="card">
      <div class="empty-state">
        <div class="empty-state-icon">&#9888;</div>
        <div class="empty-state-title">Error</div>
        <div class="empty-state-text">${escapeHtml(message)}</div>
        <a href="/admin/projects" class="btn btn-primary">Retry</a>
      </div>
    </div>
  `;
}
