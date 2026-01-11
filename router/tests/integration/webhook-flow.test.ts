import { createTestEnvironment, skipIfNoDocker } from '../helpers/integration';
import { mockWebhookPayloads } from '../fixtures/webhook-payloads';

/**
 * Integration tests for the complete webhook flow
 * These tests require Docker to be running
 */
describe('Webhook Flow Integration', () => {
  const env = createTestEnvironment();

  // Skip tests if Docker is not available
  skipIfNoDocker();

  beforeAll(async () => {
    await env.setup();
  }, 60000); // 60s timeout for setup

  afterAll(async () => {
    await env.teardown();
  }, 30000); // 30s timeout for teardown

  beforeEach(async () => {
    await env.clearRedis();
  });

  // Note: End-to-end webhook→queue flow tests are in queue-integration.test.ts

  describe('Redis Infrastructure', () => {
    it('should connect to Redis', async () => {
      const redis = env.getRedis();
      const result = await redis.ping();
      expect(result).toBe('PONG');
    });

    it('should clear Redis database', async () => {
      const redis = env.getRedis();

      // Set a key
      await redis.set('test-key', 'test-value');
      expect(await redis.get('test-key')).toBe('test-value');

      // Clear database
      await env.clearRedis();

      // Verify key is gone
      expect(await redis.get('test-key')).toBeNull();
    });

    it('should isolate test data', async () => {
      const redis = env.getRedis();

      // Ensure we're on DB 15
      await redis.select(15);

      // Set data in test DB (15)
      await redis.set('test-isolation', 'test-value');

      // Verify it exists
      expect(await redis.get('test-isolation')).toBe('test-value');

      // Use a separate connection to check DB 0 (to avoid changing our main connection's DB)
      const Redis = require('ioredis');
      const redis0 = new Redis({ host: 'localhost', port: 6380, db: 0 });
      const valueInDb0 = await redis0.get('test-isolation');
      await redis0.quit();

      // Should not exist in DB 0
      expect(valueInDb0).toBeNull();
    });
  });
});
