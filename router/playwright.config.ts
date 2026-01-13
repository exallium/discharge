import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for admin UI e2e tests
 *
 * Run with: npm run test:e2e
 * Run in UI mode: npm run test:e2e:ui
 *
 * Requires test Docker services running:
 *   docker compose -f docker-compose.test.yml up -d
 *
 * Environment is loaded via dotenv-cli from .env.test
 */

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['list'],
  ],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Start the dev server before running tests (when not in CI)
  // Uses dev:test which loads .env.test via dotenv-cli
  webServer: process.env.CI
    ? undefined
    : {
        command: 'npm run dev:test',
        url: 'http://localhost:3000/api/live',
        reuseExistingServer: !process.env.CI,
        timeout: 60000,
      },
});
