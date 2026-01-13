/**
 * Playwright test fixtures for admin UI e2e tests
 *
 * Provides authenticated page, API helpers, and test data utilities.
 * Updated for Next.js with cookie-based session authentication.
 */

import { test as base, expect, Page, BrowserContext } from '@playwright/test';

// Test credentials from .env.test
const TEST_USERNAME = 'admin';
const TEST_PASSWORD = 'testpassword123';

/**
 * Extended test fixtures
 */
export const test = base.extend<{
  authenticatedPage: Page;
  apiHelper: APIHelper;
  authenticatedContext: BrowserContext;
}>({
  /**
   * A browser context with session cookie set via login
   */
  authenticatedContext: async ({ browser }, use) => {
    // Create a new context
    const context = await browser.newContext();
    const page = await context.newPage();

    // Login to get session cookie
    const response = await page.request.post('/api/auth/login', {
      data: {
        username: TEST_USERNAME,
        password: TEST_PASSWORD,
      },
    });

    // If login fails, it might be because we need to set up the password first
    // or use environment-based auth
    if (!response.ok()) {
      console.warn('Login returned non-OK status, continuing with tests...');
    }

    await page.close();
    await use(context);
    await context.close();
  },

  /**
   * A page that's already authenticated via cookie session
   */
  authenticatedPage: async ({ authenticatedContext }, use) => {
    const page = await authenticatedContext.newPage();
    await use(page);
  },

  /**
   * API helper for setting up test data
   */
  apiHelper: async ({ authenticatedContext }, use) => {
    const page = await authenticatedContext.newPage();
    const helper = new APIHelper(page);
    await use(helper);
    await page.close();
  },
});

/**
 * API helper class for test data management
 */
class APIHelper {
  constructor(private page: Page) {}

  /**
   * Create a test project via API
   */
  async createProject(data: {
    id: string;
    repoFullName: string;
    repo?: string;
    branch?: string;
  }): Promise<void> {
    const response = await this.page.request.post('/api/projects', {
      data: {
        id: data.id,
        repoFullName: data.repoFullName,
        repo: data.repo || `https://github.com/${data.repoFullName}.git`,
        branch: data.branch || 'main',
        vcs: { type: 'github' },
        runner: { type: 'claude-code' },
        triggers: {},
        enabled: true,
      },
    });

    if (!response.ok()) {
      const body = await response.text();
      // Ignore "already exists" errors
      if (!body.includes('already exists') && !body.includes('duplicate')) {
        throw new Error(`Failed to create project: ${response.status()} ${body}`);
      }
    }
  }

  /**
   * Delete a test project via API
   */
  async deleteProject(id: string): Promise<void> {
    await this.page.request.delete(`/api/projects/${id}`);
    // Ignore errors - project might not exist
  }

  /**
   * Update a setting via API
   */
  async setSetting(category: string, key: string, value: string): Promise<void> {
    const response = await this.page.request.put(`/api/settings/${category}/${key}`, {
      data: { value },
    });

    if (!response.ok()) {
      console.warn(`Failed to set setting: ${response.status()}`);
    }
  }

  /**
   * Clear a setting via API
   */
  async clearSetting(category: string, key: string): Promise<void> {
    await this.page.request.delete(`/api/settings/${category}/${key}`);
  }
}

export { expect };

/**
 * Generate a unique test ID to avoid collisions
 */
export function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}
