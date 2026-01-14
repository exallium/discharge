/**
 * Playwright global setup
 *
 * Runs before all tests to complete the initial setup flow.
 * This ensures the admin password is set in the database so tests
 * don't get redirected to the setup page.
 */

import { request } from '@playwright/test';
import * as path from 'path';

// Load test environment variables
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../../.env.test') });

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3000';
const TEST_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const TEST_PASSWORD = process.env.ADMIN_PASSWORD || 'testpassword123';

async function globalSetup() {
  console.log('Global setup: Completing initial setup flow...');

  const context = await request.newContext({
    baseURL: BASE_URL,
  });

  try {
    // Step 1: Login with env password to get session
    const loginResponse = await context.post('/api/auth/login', {
      data: {
        username: TEST_USERNAME,
        password: TEST_PASSWORD,
      },
    });

    if (!loginResponse.ok()) {
      console.log(`Login response: ${loginResponse.status()}`);
      // If login fails, the server might not be ready yet - this is ok
      // The webServer config should wait for it
    }

    // Step 2: Complete setup by setting DB password
    // This makes isSetupRequired() return false
    const setupResponse = await context.post('/api/setup', {
      data: {
        username: TEST_USERNAME,
        password: TEST_PASSWORD,
      },
    });

    if (setupResponse.ok()) {
      console.log('Global setup: Setup completed successfully');
    } else {
      const body = await setupResponse.text();
      // "Setup already completed" is fine - means DB already has password
      if (body.includes('already completed')) {
        console.log('Global setup: Setup already completed (from previous run)');
      } else if (body.includes('Must be logged in')) {
        console.log('Global setup: Not logged in - login may have failed');
      } else {
        console.log(`Global setup: Setup returned ${setupResponse.status()}: ${body}`);
      }
    }
  } finally {
    await context.dispose();
  }
}

export default globalSetup;
