import request from 'supertest';
import express from 'express';
import { createTestEnvironment, skipIfNoDocker } from '../helpers/integration';
import { webhookRouter } from '../../src/webhooks';
import { initializeQueue, getQueueStats, closeQueue } from '../../src/queue';
import { triggers } from '../../src/triggers';
import { createMockTrigger } from '../mocks/mock-trigger';
import { mockWebhookPayloads } from '../fixtures/webhook-payloads';

describe('Queue Integration', () => {
  const env = createTestEnvironment();
  let app: express.Application;
  let mockTrigger: ReturnType<typeof createMockTrigger>;

  skipIfNoDocker();

  beforeAll(async () => {
    await env.setup();

    // Initialize queue with test Redis
    process.env.REDIS_URL = 'redis://localhost:6380/15';
    await initializeQueue();

    // Set up Express app
    app = express();
    app.use(express.json());
    app.use('/webhooks', webhookRouter);

    // Register mock trigger
    mockTrigger = createMockTrigger();
    triggers.length = 0;
    triggers.push(mockTrigger);
  }, 60000);

  afterAll(async () => {
    await closeQueue();
    await env.teardown();
  }, 30000);

  beforeEach(async () => {
    await env.clearRedis();
    mockTrigger.reset();
  });

  it('should queue job when webhook is received', async () => {
    const payload = mockWebhookPayloads.mock.valid;

    // Send webhook
    const response = await request(app)
      .post('/webhooks/mock')
      .send(payload)
      .expect(202);

    expect(response.body).toMatchObject({
      queued: true,
      triggerType: 'mock',
    });
    expect(response.body.jobId).toBeTruthy();

    // Verify job was queued
    const stats = await getQueueStats();
    expect(stats.waiting + stats.active).toBeGreaterThan(0);
  });

  it('should handle multiple concurrent webhooks', async () => {
    const payloads = [
      { ...mockWebhookPayloads.mock.valid, issueId: 'test-1' },
      { ...mockWebhookPayloads.mock.valid, issueId: 'test-2' },
      { ...mockWebhookPayloads.mock.valid, issueId: 'test-3' },
    ];

    // Send webhooks concurrently
    const responses = await Promise.all(
      payloads.map(payload =>
        request(app)
          .post('/webhooks/mock')
          .send(payload)
      )
    );

    // All should succeed
    responses.forEach(res => {
      expect(res.status).toBe(202);
      expect(res.body.queued).toBe(true);
    });

    // Verify all jobs were queued
    const stats = await getQueueStats();
    expect(stats.waiting + stats.active).toBe(3);
  });

  it('should not queue job if webhook is invalid', async () => {
    const payload = mockWebhookPayloads.mock.invalid;

    // Send webhook
    await request(app)
      .post('/webhooks/mock')
      .send(payload)
      .expect(200); // 200 because it's filtered, not error

    // Verify no job was queued
    const stats = await getQueueStats();
    expect(stats.waiting + stats.active).toBe(0);
  });

  it('should not queue job if validation fails', async () => {
    mockTrigger.setValidation(false);

    const payload = mockWebhookPayloads.mock.valid;

    // Send webhook
    await request(app)
      .post('/webhooks/mock')
      .send(payload)
      .expect(401); // Validation failed

    // Verify no job was queued
    const stats = await getQueueStats();
    expect(stats.waiting + stats.active).toBe(0);
  });
});
