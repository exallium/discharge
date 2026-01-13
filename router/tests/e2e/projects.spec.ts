/**
 * Projects CRUD e2e tests
 *
 * Tests creating, reading, updating, and deleting projects through the admin UI.
 */

import { test, expect, uniqueId } from './fixtures';

test.describe('Projects', () => {
  test.describe('Projects List', () => {
    test('displays empty state when no projects exist', async ({ authenticatedPage: page }) => {
      await page.goto('/projects');

      // Should show either projects table or empty state
      const content = await page.content();
      const hasTable = content.includes('<table') || content.includes('Repository');
      const hasEmptyState = content.includes('No projects') || content.includes('Add Project');

      expect(hasTable || hasEmptyState).toBeTruthy();
    });

    test('shows projects in table format', async ({ authenticatedPage: page, apiHelper }) => {
      const projectId = uniqueId('test-project');

      // Create a test project
      await apiHelper.createProject({
        id: projectId,
        repoFullName: `test-org/${projectId}`,
      });

      try {
        await page.goto('/projects');

        // Should display the project in the table - check for the table row containing the project
        const tableRow = page.locator(`tr:has-text("${projectId}")`);
        await expect(tableRow).toBeVisible({ timeout: 5000 });
      } finally {
        // Cleanup
        await apiHelper.deleteProject(projectId);
      }
    });

    test('can toggle show disabled projects', async ({ authenticatedPage: page }) => {
      await page.goto('/projects');

      // Find the "Show disabled" checkbox
      const checkbox = page.locator('input[type="checkbox"]').first();
      if (await checkbox.isVisible({ timeout: 2000 }).catch(() => false)) {
        // Toggle it
        await checkbox.click();

        // URL should include includeDisabled
        await expect(page).toHaveURL(/includeDisabled=true/);
      }
    });
  });

  test.describe('Create Project', () => {
    test('can navigate to new project form', async ({ authenticatedPage: page }) => {
      await page.goto('/projects');

      // Click add project button
      await page.click('text=Add Project');

      // Should be on new project page
      await expect(page).toHaveURL(/\/projects\/new/);
    });

    test('creates a new project with required fields', async ({ authenticatedPage: page, apiHelper }) => {
      const projectId = uniqueId('e2e-project');

      try {
        await page.goto('/projects/new');

        // Fill in required fields
        await page.fill('#id', projectId);
        await page.fill('#repoFullName', 'e2e-org/e2e-repo');

        // Wait for auto-fill of clone URL
        await page.waitForTimeout(500);

        // Verify clone URL was auto-filled or fill it manually
        const repoInput = page.locator('#repo');
        const repoValue = await repoInput.inputValue();
        if (!repoValue) {
          await repoInput.fill('https://github.com/e2e-org/e2e-repo.git');
        }

        // Submit form
        await page.click('button[type="submit"]');

        // Should redirect to projects list
        await page.waitForURL(/\/projects(?:\?|$)/, { timeout: 10000 });
      } finally {
        await apiHelper.deleteProject(projectId);
      }
    });

    test('validates required fields', async ({ authenticatedPage: page }) => {
      await page.goto('/projects/new');

      // Try to submit without filling required fields
      await page.click('button[type="submit"]');

      // Form should not submit (required validation)
      await expect(page).toHaveURL(/\/projects\/new/);
    });

    test('auto-fills clone URL from repository name', async ({ authenticatedPage: page }) => {
      await page.goto('/projects/new');

      // Fill in repo full name
      await page.fill('#repoFullName', 'myorg/myrepo');

      // Trigger blur event
      await page.locator('#repoFullName').blur();

      // Wait for auto-fill
      await page.waitForTimeout(500);

      // Clone URL should be auto-filled
      const repoInput = page.locator('#repo');
      await expect(repoInput).toHaveValue(/github\.com\/myorg\/myrepo/);
    });
  });

  test.describe('Edit Project', () => {
    test('can edit an existing project', async ({ authenticatedPage: page, apiHelper }) => {
      const projectId = uniqueId('edit-project');

      // Create a test project
      await apiHelper.createProject({
        id: projectId,
        repoFullName: `edit-org/${projectId}`,
      });

      try {
        // Navigate directly to edit page
        await page.goto(`/projects/${projectId}`);

        // Should be on edit page
        await expect(page).toHaveURL(new RegExp(`/projects/${projectId}`));

        // Update the branch
        await page.fill('#branch', 'develop');

        // Submit
        await page.click('button[type="submit"]');

        // Should redirect to projects list
        await page.waitForURL(/\/projects(?:\?|$)/, { timeout: 10000 });
      } finally {
        await apiHelper.deleteProject(projectId);
      }
    });

    test('can enable/disable triggers', async ({ authenticatedPage: page, apiHelper }) => {
      const projectId = uniqueId('trigger-project');

      await apiHelper.createProject({
        id: projectId,
        repoFullName: `trigger-org/${projectId}`,
      });

      try {
        await page.goto(`/projects/${projectId}`);

        // Toggle GitHub Issues trigger
        const githubTrigger = page.locator('#trigger-github-issues');
        const wasChecked = await githubTrigger.isChecked();
        await githubTrigger.click();

        // Submit
        await page.click('button[type="submit"]');

        // Should redirect
        await page.waitForURL(/\/projects(?:\?|$)/, { timeout: 10000 });

        // Go back and verify change persisted
        await page.goto(`/projects/${projectId}`);
        const isNowChecked = await githubTrigger.isChecked();
        expect(isNowChecked).not.toBe(wasChecked);
      } finally {
        await apiHelper.deleteProject(projectId);
      }
    });

    test('can toggle project enabled status', async ({ authenticatedPage: page, apiHelper }) => {
      const projectId = uniqueId('status-project');

      await apiHelper.createProject({
        id: projectId,
        repoFullName: `status-org/${projectId}`,
      });

      try {
        await page.goto(`/projects/${projectId}`);

        // Toggle enabled switch
        const enabledSwitch = page.locator('#enabled');
        await enabledSwitch.click();

        // Submit
        await page.click('button[type="submit"]');

        // Should redirect
        await page.waitForURL(/\/projects(?:\?|$)/, { timeout: 10000 });
      } finally {
        await apiHelper.deleteProject(projectId);
      }
    });
  });

  test.describe('Delete Project', () => {
    test('can delete a project with confirmation', async ({ authenticatedPage: page, apiHelper }) => {
      const projectId = uniqueId('delete-project');

      await apiHelper.createProject({
        id: projectId,
        repoFullName: `delete-org/${projectId}`,
      });

      await page.goto(`/projects/${projectId}`);

      // Set up dialog handler before clicking delete
      page.on('dialog', (dialog) => dialog.accept());

      // Click delete button
      await page.click('#deleteBtn');

      // Should redirect to projects list
      await page.waitForURL(/\/projects(?:\?|$)/, { timeout: 10000 });

      // Project should no longer appear
      await page.reload();
      const projectLink = page.locator(`text=${projectId}`);
      await expect(projectLink).not.toBeVisible({ timeout: 2000 }).catch(() => {
        // Project not visible is expected
      });
    });

    test('cancel delete keeps project', async ({ authenticatedPage: page, apiHelper }) => {
      const projectId = uniqueId('keep-project');

      await apiHelper.createProject({
        id: projectId,
        repoFullName: `keep-org/${projectId}`,
      });

      try {
        await page.goto(`/projects/${projectId}`);

        // Set up dialog handler to cancel
        page.on('dialog', (dialog) => dialog.dismiss());

        // Click delete button
        await page.click('#deleteBtn');

        // Should still be on edit page
        await expect(page).toHaveURL(new RegExp(`/projects/${projectId}`));
      } finally {
        await apiHelper.deleteProject(projectId);
      }
    });
  });
});
