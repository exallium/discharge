import express from 'express';
import request from 'supertest';

/**
 * Create a test Express app instance
 */
export function createTestApp() {
  const app = express();
  app.use(express.json());
  return app;
}

/**
 * Create a supertest agent for making requests
 */
export function createTestAgent(app: express.Application) {
  return request(app);
}

/**
 * Wait for a condition to be true
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeout = 5000,
  interval = 100
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await condition()) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  throw new Error('Timeout waiting for condition');
}

/**
 * Sleep helper for testing
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
