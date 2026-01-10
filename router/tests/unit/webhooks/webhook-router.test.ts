import express from 'express';
import request from 'supertest';
import { webhookRouter } from '../../../src/webhooks';
import { triggers } from '../../../src/triggers';
import { createMockTrigger } from '../../mocks/mock-trigger';
import { mockWebhookPayloads } from '../../fixtures/webhook-payloads';

describe('Webhook Router', () => {
  let app: express.Application;
  let mockTrigger: ReturnType<typeof createMockTrigger>;

  beforeEach(() => {
    // Create test app
    app = express();
    app.use(express.json());
    app.use('/webhooks', webhookRouter);

    // Create and register mock trigger
    mockTrigger = createMockTrigger();
    triggers.length = 0; // Clear triggers array
    triggers.push(mockTrigger);
  });

  describe('POST /webhooks/:triggerId', () => {
    it('should process valid webhook', async () => {
      const payload = mockWebhookPayloads.mock.valid;

      const response = await request(app)
        .post('/webhooks/mock')
        .send(payload)
        .expect(202);

      expect(response.body).toMatchObject({
        queued: true,
        triggerType: 'mock',
      });

      // Verify trigger methods were called
      expect(mockTrigger.calls.validateWebhook).toBe(1);
      expect(mockTrigger.calls.parseWebhook).toBe(1);
    });

    it('should return 404 for unknown trigger', async () => {
      const response = await request(app)
        .post('/webhooks/unknown')
        .send({})
        .expect(404);

      expect(response.body.error).toBe('Unknown trigger');
      expect(response.body.available).toEqual(['mock']);
    });

    it('should return 401 for invalid signature', async () => {
      mockTrigger.setValidation(false);

      await request(app)
        .post('/webhooks/mock')
        .send({})
        .expect(401);
    });

    it('should ignore filtered events', async () => {
      const payload = mockWebhookPayloads.mock.invalid;

      const response = await request(app)
        .post('/webhooks/mock')
        .send(payload)
        .expect(200);

      expect(response.body).toMatchObject({
        ignored: true,
        reason: 'Event filtered by trigger plugin',
      });
    });

    it('should respect shouldProcess filter', async () => {
      mockTrigger.shouldProcessResult = false;

      const payload = mockWebhookPayloads.mock.valid;

      const response = await request(app)
        .post('/webhooks/mock')
        .send(payload)
        .expect(200);

      expect(response.body).toMatchObject({
        ignored: true,
        reason: 'Event filtered by shouldProcess',
      });
    });

    it('should handle trigger errors gracefully', async () => {
      // Make parseWebhook throw an error
      mockTrigger.parseWebhook = jest.fn().mockRejectedValue(new Error('Parse error'));

      await request(app)
        .post('/webhooks/mock')
        .send({})
        .expect(500);
    });
  });

  describe('GET /webhooks', () => {
    it('should list available endpoints', async () => {
      const response = await request(app)
        .get('/webhooks')
        .expect(200);

      expect(response.body.endpoints).toEqual([
        {
          id: 'mock',
          url: '/webhooks/mock',
          method: 'POST',
        },
      ]);
    });

    it('should return empty list when no triggers configured', async () => {
      triggers.length = 0;

      const response = await request(app)
        .get('/webhooks')
        .expect(200);

      expect(response.body.endpoints).toEqual([]);
    });
  });
});
