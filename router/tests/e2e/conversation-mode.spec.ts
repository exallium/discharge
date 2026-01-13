/**
 * Conversation Mode e2e tests
 *
 * Tests the conversation mode settings in project forms,
 * including the toggle visibility behavior and settings persistence.
 */

import { test, expect, uniqueId } from './fixtures';

test.describe('Conversation Mode', () => {
  test.describe('New Project Form', () => {
    test('conversation settings are hidden by default', async ({ authenticatedPage: page }) => {
      await page.goto('/projects/new');

      // Conversation settings section should be hidden
      const settingsSection = page.locator('#conversationSettings');
      await expect(settingsSection).toBeHidden();

      // Enable checkbox should be visible and unchecked
      const enableCheckbox = page.locator('#conversationEnabled');
      await expect(enableCheckbox).toBeVisible();
      await expect(enableCheckbox).not.toBeChecked();
    });

    test('toggling conversation mode shows/hides settings', async ({ authenticatedPage: page }) => {
      await page.goto('/projects/new');

      const enableCheckbox = page.locator('#conversationEnabled');
      const settingsSection = page.locator('#conversationSettings');

      // Initially hidden
      await expect(settingsSection).toBeHidden();

      // Enable conversation mode
      await enableCheckbox.check();

      // Settings should now be visible
      await expect(settingsSection).toBeVisible();

      // Should see threshold input
      const threshold = page.locator('#conversationAutoExecuteThreshold');
      await expect(threshold).toBeVisible();

      // Should see max iterations input
      const maxIterations = page.locator('#conversationMaxIterations');
      await expect(maxIterations).toBeVisible();

      // Should see routing tag inputs
      const planTag = page.locator('#routingTagPlan');
      const autoTag = page.locator('#routingTagAuto');
      const assistTag = page.locator('#routingTagAssist');
      await expect(planTag).toBeVisible();
      await expect(autoTag).toBeVisible();
      await expect(assistTag).toBeVisible();

      // Disable conversation mode
      await enableCheckbox.uncheck();

      // Settings should be hidden again
      await expect(settingsSection).toBeHidden();
    });

    test('can create project with conversation mode enabled', async ({ authenticatedPage: page, apiHelper }) => {
      const projectId = uniqueId('conv-project');

      try {
        await page.goto('/projects/new');

        // Fill required fields
        await page.fill('#id', projectId);
        await page.fill('#repoFullName', 'conv-org/conv-repo');
        await page.waitForTimeout(500);

        const repoInput = page.locator('#repo');
        if (!(await repoInput.inputValue())) {
          await repoInput.fill('https://github.com/conv-org/conv-repo.git');
        }

        // Enable conversation mode
        await page.locator('#conversationEnabled').check();

        // Set conversation options
        await page.fill('#conversationAutoExecuteThreshold', '0.75');
        await page.fill('#conversationMaxIterations', '15');
        await page.fill('#routingTagPlan', 'custom:plan');
        await page.fill('#routingTagAuto', 'custom:auto');
        await page.fill('#routingTagAssist', 'custom:assist');

        // Submit
        await page.click('button[type="submit"]');

        // Should redirect to projects list
        await page.waitForURL(/\/projects(?:\?|$)/, { timeout: 10000 });

        // Verify settings persisted by editing the project
        await page.goto(`/projects/${projectId}`);

        // Conversation mode should be enabled
        const enableCheckbox = page.locator('#conversationEnabled');
        await expect(enableCheckbox).toBeChecked();

        // Settings section should be visible
        const settingsSection = page.locator('#conversationSettings');
        await expect(settingsSection).toBeVisible();

        // Values should be persisted
        await expect(page.locator('#conversationAutoExecuteThreshold')).toHaveValue('0.75');
        await expect(page.locator('#conversationMaxIterations')).toHaveValue('15');
        await expect(page.locator('#routingTagPlan')).toHaveValue('custom:plan');
        await expect(page.locator('#routingTagAuto')).toHaveValue('custom:auto');
        await expect(page.locator('#routingTagAssist')).toHaveValue('custom:assist');
      } finally {
        await apiHelper.deleteProject(projectId);
      }
    });

    test('creates project without conversation mode by default', async ({ authenticatedPage: page, apiHelper }) => {
      const projectId = uniqueId('no-conv-project');

      try {
        await page.goto('/projects/new');

        // Fill required fields only
        await page.fill('#id', projectId);
        await page.fill('#repoFullName', 'no-conv-org/no-conv-repo');
        await page.waitForTimeout(500);

        const repoInput = page.locator('#repo');
        if (!(await repoInput.inputValue())) {
          await repoInput.fill('https://github.com/no-conv-org/no-conv-repo.git');
        }

        // Don't enable conversation mode - submit as is
        await page.click('button[type="submit"]');

        // Should redirect
        await page.waitForURL(/\/projects(?:\?|$)/, { timeout: 10000 });

        // Verify conversation mode is not enabled
        await page.goto(`/projects/${projectId}`);

        const enableCheckbox = page.locator('#conversationEnabled');
        await expect(enableCheckbox).not.toBeChecked();

        const settingsSection = page.locator('#conversationSettings');
        await expect(settingsSection).toBeHidden();
      } finally {
        await apiHelper.deleteProject(projectId);
      }
    });
  });

  test.describe('Edit Project Form', () => {
    test('shows conversation settings when editing project with mode enabled', async ({
      authenticatedPage: page,
      apiHelper,
    }) => {
      const projectId = uniqueId('edit-conv-project');

      // Create project with conversation mode enabled via API
      await page.request.post('/api/projects', {
        data: {
          id: projectId,
          repoFullName: `edit-conv-org/${projectId}`,
          repo: `https://github.com/edit-conv-org/${projectId}.git`,
          branch: 'main',
          vcs: { type: 'github' },
          runner: { type: 'claude-code' },
          triggers: {},
          enabled: true,
          conversation: {
            enabled: true,
            autoExecuteThreshold: 0.8,
            maxIterations: 25,
            routingTags: {
              plan: 'ai:review',
              auto: 'ai:execute',
              assist: 'ai:help',
            },
          },
        },
      });

      try {
        await page.goto(`/projects/${projectId}`);

        // Conversation checkbox should be checked
        const enableCheckbox = page.locator('#conversationEnabled');
        await expect(enableCheckbox).toBeChecked();

        // Settings should be visible
        const settingsSection = page.locator('#conversationSettings');
        await expect(settingsSection).toBeVisible();

        // Values should match what we set
        await expect(page.locator('#conversationAutoExecuteThreshold')).toHaveValue('0.8');
        await expect(page.locator('#conversationMaxIterations')).toHaveValue('25');
        await expect(page.locator('#routingTagPlan')).toHaveValue('ai:review');
        await expect(page.locator('#routingTagAuto')).toHaveValue('ai:execute');
        await expect(page.locator('#routingTagAssist')).toHaveValue('ai:help');
      } finally {
        await apiHelper.deleteProject(projectId);
      }
    });

    test('can enable conversation mode on existing project', async ({ authenticatedPage: page, apiHelper }) => {
      const projectId = uniqueId('enable-conv-project');

      // Create project without conversation mode
      await apiHelper.createProject({
        id: projectId,
        repoFullName: `enable-conv-org/${projectId}`,
      });

      try {
        await page.goto(`/projects/${projectId}`);

        // Initially unchecked
        const enableCheckbox = page.locator('#conversationEnabled');
        await expect(enableCheckbox).not.toBeChecked();

        // Enable it
        await enableCheckbox.check();

        // Fill in settings
        await page.fill('#conversationAutoExecuteThreshold', '0.95');
        await page.fill('#conversationMaxIterations', '10');

        // Save
        await page.click('button[type="submit"]');

        // Should redirect
        await page.waitForURL(/\/projects(?:\?|$)/, { timeout: 10000 });

        // Go back and verify
        await page.goto(`/projects/${projectId}`);
        await expect(enableCheckbox).toBeChecked();
        await expect(page.locator('#conversationAutoExecuteThreshold')).toHaveValue('0.95');
        await expect(page.locator('#conversationMaxIterations')).toHaveValue('10');
      } finally {
        await apiHelper.deleteProject(projectId);
      }
    });

    test('can disable conversation mode on existing project', async ({ authenticatedPage: page, apiHelper }) => {
      const projectId = uniqueId('disable-conv-project');

      // Create project with conversation mode enabled
      await page.request.post('/api/projects', {
        data: {
          id: projectId,
          repoFullName: `disable-conv-org/${projectId}`,
          repo: `https://github.com/disable-conv-org/${projectId}.git`,
          branch: 'main',
          vcs: { type: 'github' },
          runner: { type: 'claude-code' },
          triggers: {},
          enabled: true,
          conversation: {
            enabled: true,
            autoExecuteThreshold: 0.85,
          },
        },
      });

      try {
        await page.goto(`/projects/${projectId}`);

        // Wait for form to be fully loaded
        await page.waitForLoadState('networkidle');

        // Initially checked
        const enableCheckbox = page.locator('#conversationEnabled');
        await expect(enableCheckbox).toBeChecked({ timeout: 5000 });

        // Disable it - wait for it to be attached and stable
        await enableCheckbox.waitFor({ state: 'attached' });
        await enableCheckbox.uncheck();

        // Settings should hide
        const settingsSection = page.locator('#conversationSettings');
        await expect(settingsSection).toBeHidden();

        // Save
        await page.click('button[type="submit"]');

        // Should redirect
        await page.waitForURL(/\/projects(?:\?|$)/, { timeout: 10000 });

        // Reload and verify it's disabled
        await page.goto(`/projects/${projectId}`);
        await expect(enableCheckbox).not.toBeChecked();
        await expect(settingsSection).toBeHidden();
      } finally {
        await apiHelper.deleteProject(projectId);
      }
    });

    test('preserves other settings when toggling conversation mode', async ({
      authenticatedPage: page,
      apiHelper,
    }) => {
      const projectId = uniqueId('preserve-project');

      await apiHelper.createProject({
        id: projectId,
        repoFullName: `preserve-org/${projectId}`,
      });

      try {
        await page.goto(`/projects/${projectId}`);

        // Enable a trigger
        await page.locator('#trigger-github-issues').check();

        // Change branch
        await page.fill('#branch', 'develop');

        // Enable conversation mode
        await page.locator('#conversationEnabled').check();
        await page.fill('#conversationAutoExecuteThreshold', '0.7');

        // Save
        await page.click('button[type="submit"]');

        // Should redirect
        await page.waitForURL(/\/projects(?:\?|$)/, { timeout: 10000 });

        // Go back and verify all settings preserved
        await page.goto(`/projects/${projectId}`);

        // Branch should be develop
        await expect(page.locator('#branch')).toHaveValue('develop');

        // Trigger should be checked
        await expect(page.locator('#trigger-github-issues')).toBeChecked();

        // Conversation should be enabled with correct threshold
        await expect(page.locator('#conversationEnabled')).toBeChecked();
        await expect(page.locator('#conversationAutoExecuteThreshold')).toHaveValue('0.7');
      } finally {
        await apiHelper.deleteProject(projectId);
      }
    });
  });

  test.describe('Input Validation', () => {
    test('auto-execute threshold accepts decimal values', async ({ authenticatedPage: page }) => {
      await page.goto('/projects/new');

      await page.locator('#conversationEnabled').check();

      const threshold = page.locator('#conversationAutoExecuteThreshold');

      // Should accept valid decimal
      await threshold.fill('0.85');
      await expect(threshold).toHaveValue('0.85');

      // Should accept 0 and 1
      await threshold.fill('0');
      await expect(threshold).toHaveValue('0');

      await threshold.fill('1');
      await expect(threshold).toHaveValue('1');
    });

    test('max iterations accepts positive integers', async ({ authenticatedPage: page }) => {
      await page.goto('/projects/new');

      await page.locator('#conversationEnabled').check();

      const maxIterations = page.locator('#conversationMaxIterations');

      // Should accept valid integer
      await maxIterations.fill('20');
      await expect(maxIterations).toHaveValue('20');

      // Should accept 1
      await maxIterations.fill('1');
      await expect(maxIterations).toHaveValue('1');
    });

    test('routing tags accept custom values', async ({ authenticatedPage: page }) => {
      await page.goto('/projects/new');

      await page.locator('#conversationEnabled').check();

      // Custom tag formats should work
      await page.fill('#routingTagPlan', 'my-custom-plan-tag');
      await page.fill('#routingTagAuto', 'auto_execute');
      await page.fill('#routingTagAssist', 'assist:mode');

      await expect(page.locator('#routingTagPlan')).toHaveValue('my-custom-plan-tag');
      await expect(page.locator('#routingTagAuto')).toHaveValue('auto_execute');
      await expect(page.locator('#routingTagAssist')).toHaveValue('assist:mode');
    });
  });
});
