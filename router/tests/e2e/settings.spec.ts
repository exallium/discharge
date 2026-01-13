/**
 * Settings e2e tests
 *
 * Tests the settings page forms and persistence.
 * Note: Current implementation has a simplified settings page with GitHub and Security sections.
 */

import { test, expect } from './fixtures';

test.describe('Settings', () => {
  test.describe('Settings Page', () => {
    test('displays settings page with sections', async ({ authenticatedPage: page }) => {
      await page.goto('/settings');

      // Should show the page header
      await expect(page.locator('h1:has-text("Settings")')).toBeVisible();

      // Should show GitHub section card
      await expect(page.locator('[class*="card"] h2:has-text("GitHub"), [class*="card"] h3:has-text("GitHub")')).toBeVisible();

      // Should show Security section card
      await expect(page.locator('[class*="card"] h2:has-text("Security"), [class*="card"] h3:has-text("Security")')).toBeVisible();
    });
  });

  test.describe('GitHub Settings', () => {
    test('displays GitHub settings form', async ({ authenticatedPage: page }) => {
      await page.goto('/settings');

      // Should show token field
      const tokenField = page.locator('#github-token');
      await expect(tokenField).toBeVisible();

      // Should show webhook secret field
      const webhookField = page.locator('#webhook-secret');
      await expect(webhookField).toBeVisible();
    });

    test('GitHub fields are password type', async ({ authenticatedPage: page }) => {
      await page.goto('/settings');

      // Token field should be password type
      const tokenField = page.locator('#github-token');
      await expect(tokenField).toHaveAttribute('type', 'password');

      // Webhook secret should be password type
      const webhookField = page.locator('#webhook-secret');
      await expect(webhookField).toHaveAttribute('type', 'password');
    });

    test('shows save button for GitHub settings', async ({ authenticatedPage: page }) => {
      await page.goto('/settings');

      // Should have a save button for GitHub settings
      const saveButton = page.locator('button:has-text("Save GitHub Settings")');
      await expect(saveButton).toBeVisible();
    });
  });

  test.describe('Security Settings', () => {
    test('displays password change form', async ({ authenticatedPage: page }) => {
      await page.goto('/settings');

      // Should show current password field
      const currentPassword = page.locator('#current-password');
      await expect(currentPassword).toBeVisible();

      // Should show new password field
      const newPassword = page.locator('#new-password');
      await expect(newPassword).toBeVisible();

      // Should show confirm password field
      const confirmPassword = page.locator('#confirm-password');
      await expect(confirmPassword).toBeVisible();
    });

    test('password fields are password type', async ({ authenticatedPage: page }) => {
      await page.goto('/settings');

      await expect(page.locator('#current-password')).toHaveAttribute('type', 'password');
      await expect(page.locator('#new-password')).toHaveAttribute('type', 'password');
      await expect(page.locator('#confirm-password')).toHaveAttribute('type', 'password');
    });

    test('shows change password button', async ({ authenticatedPage: page }) => {
      await page.goto('/settings');

      const changeButton = page.locator('button:has-text("Change Password")');
      await expect(changeButton).toBeVisible();
    });
  });
});
