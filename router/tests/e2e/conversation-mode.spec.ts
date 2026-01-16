/**
 * Conversation Mode e2e tests
 *
 * Tests the conversation settings in project forms.
 * Conversation mode is always enabled for triggers that support it.
 */

import { test, expect, uniqueId } from './fixtures';

test.describe('Conversation Settings', () => {
  test.describe('New Project Form', () => {
    test('conversation settings are always visible', async ({ authenticatedPage: page }) => {
      await page.goto('/projects/new');

      // Conversation settings should be visible
      const threshold = page.locator('#conversationAutoExecuteThreshold');
      await expect(threshold).toBeVisible();

      const maxIterations = page.locator('#conversationMaxIterations');
      await expect(maxIterations).toBeVisible();

      // Routing tags should be visible
      const planTag = page.locator('#routingTagPlan');
      const autoTag = page.locator('#routingTagAuto');
      const assistTag = page.locator('#routingTagAssist');
      await expect(planTag).toBeVisible();
      await expect(autoTag).toBeVisible();
      await expect(assistTag).toBeVisible();
    });

    test('has sensible default values', async ({ authenticatedPage: page }) => {
      await page.goto('/projects/new');

      // Check default values
      await expect(page.locator('#conversationAutoExecuteThreshold')).toHaveValue('0.85');
      await expect(page.locator('#conversationMaxIterations')).toHaveValue('20');
      await expect(page.locator('#routingTagPlan')).toHaveValue('ai:plan');
      await expect(page.locator('#routingTagAuto')).toHaveValue('ai:auto');
      await expect(page.locator('#routingTagAssist')).toHaveValue('ai:assist');
    });

    test('can create project with custom conversation settings', async ({ authenticatedPage: page, apiHelper }) => {
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

        // Set custom conversation options
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

    test('creates project with default conversation settings', async ({ authenticatedPage: page, apiHelper }) => {
      const projectId = uniqueId('default-conv-project');

      try {
        await page.goto('/projects/new');

        // Fill only required fields
        await page.fill('#id', projectId);
        await page.fill('#repoFullName', 'default-org/default-repo');
        await page.waitForTimeout(500);

        const repoInput = page.locator('#repo');
        if (!(await repoInput.inputValue())) {
          await repoInput.fill('https://github.com/default-org/default-repo.git');
        }

        // Submit with default conversation settings
        await page.click('button[type="submit"]');

        // Should redirect
        await page.waitForURL(/\/projects(?:\?|$)/, { timeout: 10000 });

        // Verify default values persisted
        await page.goto(`/projects/${projectId}`);

        await expect(page.locator('#conversationAutoExecuteThreshold')).toHaveValue('0.85');
        await expect(page.locator('#conversationMaxIterations')).toHaveValue('20');
      } finally {
        await apiHelper.deleteProject(projectId);
      }
    });
  });

  test.describe('Edit Project Form', () => {
    test('shows conversation settings when editing existing project', async ({
      authenticatedPage: page,
      apiHelper,
    }) => {
      const projectId = uniqueId('edit-conv-project');

      // Create project with custom conversation settings via API
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

        // Settings should be visible
        await expect(page.locator('#conversationAutoExecuteThreshold')).toBeVisible();

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

    test('can update conversation settings on existing project', async ({ authenticatedPage: page, apiHelper }) => {
      const projectId = uniqueId('update-conv-project');

      // Create project with default settings
      await apiHelper.createProject({
        id: projectId,
        repoFullName: `update-conv-org/${projectId}`,
      });

      try {
        await page.goto(`/projects/${projectId}`);

        // Update settings
        await page.fill('#conversationAutoExecuteThreshold', '0.95');
        await page.fill('#conversationMaxIterations', '10');

        // Save
        await page.click('button[type="submit"]');

        // Should redirect
        await page.waitForURL(/\/projects(?:\?|$)/, { timeout: 10000 });

        // Go back and verify
        await page.goto(`/projects/${projectId}`);
        await expect(page.locator('#conversationAutoExecuteThreshold')).toHaveValue('0.95');
        await expect(page.locator('#conversationMaxIterations')).toHaveValue('10');
      } finally {
        await apiHelper.deleteProject(projectId);
      }
    });

    test('preserves conversation settings when changing other fields', async ({
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

        // Set custom conversation settings
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

        // Conversation settings should be preserved
        await expect(page.locator('#conversationAutoExecuteThreshold')).toHaveValue('0.7');
      } finally {
        await apiHelper.deleteProject(projectId);
      }
    });
  });

  test.describe('Input Validation', () => {
    test('auto-execute threshold accepts decimal values', async ({ authenticatedPage: page }) => {
      await page.goto('/projects/new');

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
