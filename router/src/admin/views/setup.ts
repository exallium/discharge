/**
 * Admin Setup Wizard view
 *
 * First-run setup wizard for initial configuration.
 */

import { Request, Response } from 'express';
import { isFirstRunSetup } from '../../db';

/**
 * Render the setup wizard page
 */
export async function renderSetup(req: Request, res: Response): Promise<void> {
  // Check if setup is still needed
  const needsSetup = await isFirstRunSetup();

  if (!needsSetup) {
    // Redirect to dashboard if already configured
    res.redirect('/admin/dashboard');
    return;
  }

  const step = parseInt(req.query.step as string) || 1;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Setup - AI Bug Fixer</title>
  <style>
${getSetupStyles()}
  </style>
</head>
<body>
  <div class="setup-container">
    <div class="setup-header">
      <div class="logo">
        <svg width="48" height="48" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="32" height="32" rx="8" fill="#006A6A"/>
          <path d="M16 6L8 10v12l8 4 8-4V10l-8-4z" fill="#FFFFFF" opacity="0.9"/>
          <circle cx="16" cy="16" r="4" fill="#006A6A"/>
        </svg>
      </div>
      <h1>Welcome to AI Bug Fixer</h1>
      <p>Let's get your system set up in just a few steps.</p>
    </div>

    <div class="setup-progress">
      <div class="progress-step ${step >= 1 ? 'active' : ''} ${step > 1 ? 'complete' : ''}">
        <span class="step-number">1</span>
        <span class="step-label">Admin Password</span>
      </div>
      <div class="progress-line ${step > 1 ? 'active' : ''}"></div>
      <div class="progress-step ${step >= 2 ? 'active' : ''} ${step > 2 ? 'complete' : ''}">
        <span class="step-number">2</span>
        <span class="step-label">GitHub Token</span>
      </div>
      <div class="progress-line ${step > 2 ? 'active' : ''}"></div>
      <div class="progress-step ${step >= 3 ? 'active' : ''} ${step > 3 ? 'complete' : ''}">
        <span class="step-number">3</span>
        <span class="step-label">Add Project</span>
      </div>
    </div>

    <div class="setup-content">
      ${step === 1 ? renderStep1() : ''}
      ${step === 2 ? renderStep2() : ''}
      ${step === 3 ? renderStep3() : ''}
    </div>
  </div>

  <script>
    ${getSetupScript()}
  </script>
</body>
</html>`;

  res.send(html);
}

function renderStep1(): string {
  return `
    <div class="step-content">
      <h2>Set Admin Password</h2>
      <p class="step-description">Create a secure password for accessing the admin dashboard.</p>

      <form id="passwordForm" class="setup-form">
        <div class="form-group">
          <label for="password">Password</label>
          <input type="password" id="password" name="password" required minlength="12"
                 placeholder="At least 12 characters">
        </div>

        <div class="form-group">
          <label for="confirmPassword">Confirm Password</label>
          <input type="password" id="confirmPassword" name="confirmPassword" required minlength="12"
                 placeholder="Re-enter your password">
        </div>

        <div class="form-actions">
          <button type="submit" class="btn btn-primary">Set Password & Continue</button>
        </div>
      </form>
    </div>
  `;
}

function renderStep2(): string {
  return `
    <div class="step-content">
      <h2>Configure GitHub</h2>
      <p class="step-description">Add your GitHub token to enable repository access and PR creation.</p>

      <form id="githubForm" class="setup-form">
        <div class="form-group">
          <label for="githubToken">GitHub Personal Access Token</label>
          <input type="password" id="githubToken" name="githubToken" required
                 placeholder="ghp_xxxxxxxxxxxx">
          <p class="form-help">
            Create a token at <a href="https://github.com/settings/tokens" target="_blank">github.com/settings/tokens</a><br>
            Required scopes: <code>repo</code>, <code>read:org</code>
          </p>
        </div>

        <div class="form-group">
          <label for="webhookSecret">Webhook Secret (Optional)</label>
          <input type="password" id="webhookSecret" name="webhookSecret"
                 placeholder="Your webhook secret">
          <p class="form-help">Used to validate incoming webhooks from GitHub</p>
        </div>

        <div class="form-actions">
          <a href="/admin/setup?step=1" class="btn btn-ghost">Back</a>
          <button type="submit" class="btn btn-primary">Save & Continue</button>
        </div>
      </form>
    </div>
  `;
}

function renderStep3(): string {
  return `
    <div class="step-content">
      <h2>Add Your First Project</h2>
      <p class="step-description">Configure a repository to start fixing bugs automatically.</p>

      <form id="projectForm" class="setup-form">
        <div class="form-group">
          <label for="repoFullName">Repository</label>
          <input type="text" id="repoFullName" name="repoFullName" required
                 placeholder="owner/repo">
          <p class="form-help">Full repository name (e.g., myorg/my-repo)</p>
        </div>

        <div class="form-group">
          <label for="projectId">Project ID</label>
          <input type="text" id="projectId" name="projectId" required
                 placeholder="my-project" pattern="[a-z0-9-]+">
          <p class="form-help">A unique identifier (lowercase, hyphens allowed)</p>
        </div>

        <div class="form-group">
          <label>Triggers</label>
          <div class="checkbox-group">
            <label class="checkbox-label">
              <input type="checkbox" name="triggers" value="github-issues" checked>
              <span>GitHub Issues</span>
            </label>
            <label class="checkbox-label">
              <input type="checkbox" name="triggers" value="sentry">
              <span>Sentry Errors</span>
            </label>
          </div>
        </div>

        <div class="form-actions">
          <a href="/admin/setup?step=2" class="btn btn-ghost">Back</a>
          <button type="submit" class="btn btn-primary">Complete Setup</button>
        </div>
      </form>
    </div>
  `;
}

function getSetupStyles(): string {
  return `
    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: linear-gradient(135deg, #EEF5F4 0%, #E6EFEE 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }

    .setup-container {
      background: white;
      border-radius: 16px;
      box-shadow: 0 4px 24px rgba(0, 0, 0, 0.1);
      max-width: 600px;
      width: 100%;
      padding: 40px;
    }

    .setup-header {
      text-align: center;
      margin-bottom: 32px;
    }

    .logo {
      margin-bottom: 16px;
    }

    .setup-header h1 {
      font-size: 1.5rem;
      color: #191C1C;
      margin-bottom: 8px;
    }

    .setup-header p {
      color: #6F7978;
    }

    .setup-progress {
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 32px;
    }

    .progress-step {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
    }

    .step-number {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: #DAE5E4;
      color: #6F7978;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 600;
      font-size: 0.875rem;
    }

    .progress-step.active .step-number {
      background: #006A6A;
      color: white;
    }

    .progress-step.complete .step-number {
      background: #006E2C;
      color: white;
    }

    .step-label {
      font-size: 0.75rem;
      color: #6F7978;
      white-space: nowrap;
    }

    .progress-step.active .step-label {
      color: #006A6A;
      font-weight: 500;
    }

    .progress-line {
      width: 60px;
      height: 2px;
      background: #DAE5E4;
      margin: 0 8px 24px;
    }

    .progress-line.active {
      background: #006A6A;
    }

    .step-content h2 {
      font-size: 1.25rem;
      color: #191C1C;
      margin-bottom: 8px;
    }

    .step-description {
      color: #6F7978;
      margin-bottom: 24px;
    }

    .form-group {
      margin-bottom: 20px;
    }

    .form-group label {
      display: block;
      font-size: 0.875rem;
      font-weight: 500;
      color: #191C1C;
      margin-bottom: 6px;
    }

    .form-group input[type="text"],
    .form-group input[type="password"] {
      width: 100%;
      padding: 12px 16px;
      border: 1px solid #BEC9C8;
      border-radius: 8px;
      font-size: 1rem;
      transition: border-color 0.15s, box-shadow 0.15s;
    }

    .form-group input:focus {
      outline: none;
      border-color: #006A6A;
      box-shadow: 0 0 0 3px rgba(0, 106, 106, 0.15);
    }

    .form-help {
      font-size: 0.75rem;
      color: #6F7978;
      margin-top: 6px;
    }

    .form-help a {
      color: #006A6A;
    }

    .form-help code {
      background: #DAE5E4;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 0.75rem;
    }

    .checkbox-group {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin-top: 8px;
    }

    .checkbox-label {
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
    }

    .checkbox-label input {
      width: 18px;
      height: 18px;
      accent-color: #006A6A;
    }

    .form-actions {
      display: flex;
      justify-content: flex-end;
      gap: 12px;
      margin-top: 32px;
    }

    .btn {
      padding: 12px 24px;
      border-radius: 8px;
      font-size: 0.875rem;
      font-weight: 500;
      cursor: pointer;
      text-decoration: none;
      transition: all 0.15s;
      border: none;
    }

    .btn-primary {
      background: #006A6A;
      color: white;
    }

    .btn-primary:hover {
      background: #004F4F;
    }

    .btn-ghost {
      background: transparent;
      color: #6F7978;
    }

    .btn-ghost:hover {
      background: #DAE5E4;
      color: #191C1C;
    }

    .error-message {
      background: #FFDAD6;
      color: #BA1A1A;
      padding: 12px 16px;
      border-radius: 8px;
      margin-bottom: 16px;
      font-size: 0.875rem;
    }

    .success-message {
      background: #95F9AD;
      color: #006E2C;
      padding: 12px 16px;
      border-radius: 8px;
      margin-bottom: 16px;
      font-size: 0.875rem;
    }
  `;
}

function getSetupScript(): string {
  return `
    // API helper
    async function api(method, path, data) {
      const options = {
        method,
        headers: { 'Content-Type': 'application/json' },
      };
      if (data) options.body = JSON.stringify(data);
      const res = await fetch('/admin/api' + path, options);
      if (!res.ok) {
        const error = await res.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(error.error || 'Request failed');
      }
      return res.json();
    }

    function showError(message) {
      const existing = document.querySelector('.error-message');
      if (existing) existing.remove();

      const error = document.createElement('div');
      error.className = 'error-message';
      error.textContent = message;
      document.querySelector('.step-content').prepend(error);
    }

    // Step 1: Password form
    const passwordForm = document.getElementById('passwordForm');
    if (passwordForm) {
      passwordForm.addEventListener('submit', async function(e) {
        e.preventDefault();

        const password = this.password.value;
        const confirmPassword = this.confirmPassword.value;

        if (password !== confirmPassword) {
          showError('Passwords do not match');
          return;
        }

        if (password.length < 12) {
          showError('Password must be at least 12 characters');
          return;
        }

        try {
          await api('POST', '/settings/password', { newPassword: password });
          window.location.href = '/admin/setup?step=2';
        } catch (error) {
          showError(error.message);
        }
      });
    }

    // Step 2: GitHub form
    const githubForm = document.getElementById('githubForm');
    if (githubForm) {
      githubForm.addEventListener('submit', async function(e) {
        e.preventDefault();

        const token = this.githubToken.value;
        const secret = this.webhookSecret.value;

        try {
          await api('PUT', '/settings/github/token', { value: token });
          if (secret) {
            await api('PUT', '/settings/github/webhook_secret', { value: secret });
          }
          window.location.href = '/admin/setup?step=3';
        } catch (error) {
          showError(error.message);
        }
      });
    }

    // Step 3: Project form
    const projectForm = document.getElementById('projectForm');
    if (projectForm) {
      // Auto-generate project ID from repo name
      projectForm.repoFullName.addEventListener('blur', function() {
        const projectIdInput = projectForm.projectId;
        if (!projectIdInput.value && this.value) {
          projectIdInput.value = this.value.split('/')[1] || this.value.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
        }
      });

      projectForm.addEventListener('submit', async function(e) {
        e.preventDefault();

        const repoFullName = this.repoFullName.value;
        const projectId = this.projectId.value;
        const triggers = Array.from(this.querySelectorAll('input[name="triggers"]:checked'))
          .map(input => input.value);

        const data = {
          id: projectId,
          repo: 'https://github.com/' + repoFullName + '.git',
          repoFullName: repoFullName,
          branch: 'main',
          vcs: { type: 'github' },
          runner: { type: 'claude-code' },
          triggers: triggers.reduce((acc, t) => ({ ...acc, [t]: {} }), {}),
          enabled: true,
        };

        try {
          await api('POST', '/projects', data);
          window.location.href = '/admin/dashboard';
        } catch (error) {
          showError(error.message);
        }
      });
    }
  `;
}
