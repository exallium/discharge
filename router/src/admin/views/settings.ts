/**
 * Admin Settings view
 *
 * Dynamically renders settings forms based on plugin schemas.
 */

import { Request, Response } from 'express';
import { renderLayout, escapeHtml } from './layout';
import { settingsRepo } from '../../db/repositories';
import { getAllSettingsSchemas, PluginSettingsSchema, SettingDefinition } from '../../types/settings';

/**
 * Render the settings page
 */
export async function renderSettings(req: Request, res: Response): Promise<void> {
  try {
    // Get all plugin schemas and current settings
    const schemas = getAllSettingsSchemas();
    const allSettings = await settingsRepo.getAll();

    // Group settings by category (allSettings is Record<string, SettingValue[]>)
    const settingsByCategory = new Map<string, Record<string, string>>();
    for (const [category, values] of Object.entries(allSettings)) {
      if (!settingsByCategory.has(category)) {
        settingsByCategory.set(category, {});
      }
      for (const setting of values) {
        // Extract just the key part after category prefix
        const keyParts = setting.key.split('.');
        const key = keyParts.length > 1 ? keyParts.slice(1).join('.') : setting.key;
        settingsByCategory.get(category)![key] = setting.value;
      }
    }

    const activeCategory = req.query.category as string || schemas[0]?.category || 'github';

    const content = `
      <div class="page-header">
        <h1 class="page-title">Settings</h1>
        <p class="page-subtitle">Configure integrations and system settings</p>
      </div>

      <div class="flex gap-4">
        <div class="card" style="width: 200px; flex-shrink: 0;">
          <nav class="settings-nav">
            ${schemas.map(schema => `
              <a href="/admin/settings?category=${escapeHtml(schema.category)}"
                 class="nav-link ${activeCategory === schema.category ? 'active' : ''}">
                ${escapeHtml(schema.displayName)}
              </a>
            `).join('')}
            <hr style="margin: var(--space-3) 0; border: none; border-top: 1px solid var(--md-outline-variant);">
            <a href="/admin/settings?category=password" class="nav-link ${activeCategory === 'password' ? 'active' : ''}">
              Change Password
            </a>
          </nav>
        </div>

        <div class="card" style="flex: 1;">
          ${activeCategory === 'password'
            ? renderPasswordForm()
            : renderCategorySettings(schemas.find(s => s.category === activeCategory), settingsByCategory.get(activeCategory) || {})
          }
        </div>
      </div>
    `;

    const script = `
      // Handle settings form submission
      document.querySelectorAll('.settings-form').forEach(form => {
        form.addEventListener('submit', async function(e) {
          e.preventDefault();
          const category = this.dataset.category;
          const inputs = this.querySelectorAll('input, select');

          for (const input of inputs) {
            const key = input.name;
            let value = input.type === 'checkbox' ? input.checked : input.value;

            // Skip unchanged password fields
            if (input.type === 'password' && !value) continue;

            try {
              await api('PUT', '/settings/' + category + '/' + key, { value });
            } catch (error) {
              showToast('Failed to save ' + key + ': ' + error.message, 'error');
              return;
            }
          }

          showToast('Settings saved successfully', 'success');
        });
      });

      // Handle password change form
      const passwordForm = document.getElementById('passwordForm');
      if (passwordForm) {
        passwordForm.addEventListener('submit', async function(e) {
          e.preventDefault();

          const currentPassword = this.currentPassword.value;
          const newPassword = this.newPassword.value;
          const confirmPassword = this.confirmPassword.value;

          if (newPassword !== confirmPassword) {
            showToast('New passwords do not match', 'error');
            return;
          }

          if (newPassword.length < 12) {
            showToast('Password must be at least 12 characters', 'error');
            return;
          }

          try {
            await api('POST', '/settings/password', { currentPassword, newPassword });
            showToast('Password changed successfully', 'success');
            this.reset();
          } catch (error) {
            showToast(error.message, 'error');
          }
        });
      }

      // Toggle password visibility
      document.querySelectorAll('.toggle-password').forEach(btn => {
        btn.addEventListener('click', function() {
          const input = this.previousElementSibling;
          input.type = input.type === 'password' ? 'text' : 'password';
          this.textContent = input.type === 'password' ? 'Show' : 'Hide';
        });
      });
    `;

    res.send(renderLayout(content, { title: 'Settings', activeNav: 'settings', scripts: [script] }));
  } catch (error) {
    res.status(500).send(renderLayout(renderError(error), { title: 'Settings Error' }));
  }
}

function renderCategorySettings(schema: PluginSettingsSchema | undefined, values: Record<string, string>): string {
  if (!schema) {
    return `
      <div class="empty-state">
        <div class="empty-state-icon">&#9881;</div>
        <div class="empty-state-title">No settings available</div>
        <div class="empty-state-text">This category has no configurable settings.</div>
      </div>
    `;
  }

  return `
    <h2 class="card-title">${escapeHtml(schema.displayName)} Settings</h2>
    <form class="settings-form" data-category="${escapeHtml(schema.category)}">
      ${schema.settings.map(setting => renderSettingField(setting, values[setting.key])).join('')}
      <div class="mt-4">
        <button type="submit" class="btn btn-primary">Save Changes</button>
      </div>
    </form>
  `;
}

function renderSettingField(setting: SettingDefinition, value: string | undefined): string {
  const inputId = `setting-${setting.key}`;
  const isSecret = setting.encrypted || setting.type === 'password';
  const hasValue = value !== undefined && value !== '';
  const displayValue = isSecret && hasValue ? '••••••••' : (value || '');

  let inputHtml: string;

  switch (setting.type) {
    case 'boolean':
      inputHtml = `
        <label class="flex items-center gap-2">
          <input type="checkbox" id="${inputId}" name="${escapeHtml(setting.key)}"
                 ${value === 'true' ? 'checked' : ''}>
          <span>${escapeHtml(setting.label)}</span>
        </label>
      `;
      break;

    case 'select':
      inputHtml = `
        <select class="form-input" id="${inputId}" name="${escapeHtml(setting.key)}"
                ${setting.required ? 'required' : ''}>
          <option value="">Select...</option>
          ${(setting.options || []).map(opt => `
            <option value="${escapeHtml(opt.value)}" ${value === opt.value ? 'selected' : ''}>
              ${escapeHtml(opt.label)}
            </option>
          `).join('')}
        </select>
      `;
      break;

    case 'number':
      inputHtml = `
        <input class="form-input" type="number" id="${inputId}" name="${escapeHtml(setting.key)}"
               value="${escapeHtml(value || '')}"
               ${setting.required ? 'required' : ''}>
      `;
      break;

    case 'password':
      inputHtml = `
        <div class="flex gap-2">
          <input class="form-input" type="password" id="${inputId}" name="${escapeHtml(setting.key)}"
                 placeholder="${hasValue ? 'Enter new value to change' : 'Enter value'}"
                 ${setting.required && !hasValue ? 'required' : ''}>
          <button type="button" class="btn btn-ghost toggle-password">Show</button>
        </div>
        ${hasValue ? '<p class="form-help text-success">Value is set (hidden)</p>' : ''}
      `;
      break;

    case 'url':
      inputHtml = `
        <input class="form-input" type="url" id="${inputId}" name="${escapeHtml(setting.key)}"
               value="${escapeHtml(displayValue)}"
               placeholder="https://..."
               ${setting.required ? 'required' : ''}>
      `;
      break;

    default: // text
      inputHtml = `
        <input class="form-input" type="text" id="${inputId}" name="${escapeHtml(setting.key)}"
               value="${escapeHtml(displayValue)}"
               ${setting.required ? 'required' : ''}>
      `;
  }

  if (setting.type !== 'boolean') {
    return `
      <div class="form-group">
        <label class="form-label" for="${inputId}">
          ${escapeHtml(setting.label)}
          ${setting.required ? '<span class="text-error">*</span>' : ''}
        </label>
        ${inputHtml}
        ${setting.description ? `<p class="form-help">${escapeHtml(setting.description)}</p>` : ''}
      </div>
    `;
  }

  return `
    <div class="form-group">
      ${inputHtml}
      ${setting.description ? `<p class="form-help">${escapeHtml(setting.description)}</p>` : ''}
    </div>
  `;
}

function renderPasswordForm(): string {
  return `
    <h2 class="card-title">Change Admin Password</h2>
    <form id="passwordForm" class="form">
      <div class="form-group">
        <label class="form-label" for="currentPassword">Current Password</label>
        <input class="form-input" type="password" id="currentPassword" name="currentPassword">
        <p class="form-help">Leave blank if no password is set</p>
      </div>

      <div class="form-group">
        <label class="form-label" for="newPassword">New Password</label>
        <input class="form-input" type="password" id="newPassword" name="newPassword" required minlength="12">
        <p class="form-help">Minimum 12 characters</p>
      </div>

      <div class="form-group">
        <label class="form-label" for="confirmPassword">Confirm New Password</label>
        <input class="form-input" type="password" id="confirmPassword" name="confirmPassword" required minlength="12">
      </div>

      <div class="mt-4">
        <button type="submit" class="btn btn-primary">Change Password</button>
      </div>
    </form>
  `;
}

function renderError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'An error occurred';
  return `
    <div class="card">
      <div class="empty-state">
        <div class="empty-state-icon">&#9888;</div>
        <div class="empty-state-title">Error loading settings</div>
        <div class="empty-state-text">${escapeHtml(message)}</div>
        <a href="/admin/settings" class="btn btn-primary">Retry</a>
      </div>
    </div>
  `;
}
