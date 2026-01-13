/**
 * Authentication e2e tests
 *
 * Tests the admin cookie-based session authentication and login flow.
 */

import { test, expect } from '@playwright/test';

// Test credentials
const TEST_USERNAME = 'admin';
const TEST_PASSWORD = 'testpassword123';

test.describe('Authentication', () => {
  test.describe('Login Page', () => {
    test('login page is accessible without auth', async ({ page }) => {
      await page.goto('/login');

      // Should see the login form
      await expect(page.locator('input[name="username"], input[type="text"]')).toBeVisible();
      await expect(page.locator('input[name="password"], input[type="password"]')).toBeVisible();
    });

    test('can login with valid credentials', async ({ page }) => {
      await page.goto('/login');

      // Fill in credentials
      await page.fill('input[name="username"], input[type="text"]', TEST_USERNAME);
      await page.fill('input[name="password"], input[type="password"]', TEST_PASSWORD);

      // Submit
      await page.click('button[type="submit"]');

      // Should redirect to dashboard
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });
    });

    test('shows error with invalid credentials', async ({ page }) => {
      await page.goto('/login');

      // Fill in wrong credentials
      await page.fill('input[name="username"], input[type="text"]', 'admin');
      await page.fill('input[name="password"], input[type="password"]', 'wrongpassword');

      // Submit
      await page.click('button[type="submit"]');

      // Should show error and stay on login page
      await expect(page).toHaveURL(/\/login/);

      // Look for error message in the destructive-styled error div
      // The error is displayed in a div with text-destructive class containing "Invalid credentials"
      const errorDiv = page.locator('.text-destructive, [class*="destructive"]');
      await expect(errorDiv.first()).toBeVisible({ timeout: 5000 });
    });
  });

  test.describe('Protected Routes', () => {
    test('unauthenticated users are redirected to login', async ({ page }) => {
      // Try to access dashboard without auth
      await page.goto('/dashboard');

      // Should redirect to login
      await expect(page).toHaveURL(/\/login/);
    });

    test('unauthenticated API requests return 401', async ({ page }) => {
      // Try to access projects API without auth
      const response = await page.request.get('/api/projects');

      expect(response.status()).toBe(401);
    });

    test('authenticated users can access dashboard', async ({ browser }) => {
      // Create context and login
      const context = await browser.newContext();
      const page = await context.newPage();

      // Login first
      await page.request.post('/api/auth/login', {
        data: {
          username: TEST_USERNAME,
          password: TEST_PASSWORD,
        },
      });

      // Now access dashboard
      await page.goto('/dashboard');

      // Should see dashboard content
      await expect(page.locator('h1, [class*="page-header"]')).toContainText(/Dashboard/i);

      await context.close();
    });

    test('authenticated API requests work', async ({ browser }) => {
      const context = await browser.newContext();
      const page = await context.newPage();

      // Login first
      await page.request.post('/api/auth/login', {
        data: {
          username: TEST_USERNAME,
          password: TEST_PASSWORD,
        },
      });

      // Access projects API
      const response = await page.request.get('/api/projects');

      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(Array.isArray(body)).toBe(true);

      await context.close();
    });
  });

  test.describe('Session Persistence', () => {
    test('session persists across page navigation', async ({ browser }) => {
      const context = await browser.newContext();
      const page = await context.newPage();

      // Login
      await page.goto('/login');
      await page.fill('input[name="username"], input[type="text"]', TEST_USERNAME);
      await page.fill('input[name="password"], input[type="password"]', TEST_PASSWORD);
      await page.click('button[type="submit"]');

      // Wait for redirect
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });

      // Navigate to other pages
      await page.goto('/projects');
      await expect(page).toHaveURL(/\/projects/);

      await page.goto('/settings');
      await expect(page).toHaveURL(/\/settings/);

      // Should still be logged in
      await page.goto('/dashboard');
      await expect(page).toHaveURL(/\/dashboard/);

      await context.close();
    });
  });
});
