import express from 'express';
import request from 'supertest';
import { webhookRouter } from '../../../src/webhooks';
import { sources } from '../../../src/sources';
import { createMockSource } from '../../mocks/mock-source';
import { mockWebhookPayloads } from '../../fixtures/webhook-payloads';

describe('Webhook Router', () => {
  let app: express.Application;
  let mockSource: ReturnType<typeof createMockSource>;

  beforeEach(() => {
    // Create test app
    app = express();
    app.use(express.json());
    app.use('/webhooks', webhookRouter);

    // Create and register mock source
    mockSource = createMockSource();
    sources.length = 0; // Clear sources array
    sources.push(mockSource);
  });

  describe('POST /webhooks/:sourceId', () => {
    it('should process valid webhook', async () => {
      const payload = mockWebhookPayloads.mock.valid;

      const response = await request(app)
        .post('/webhooks/mock')
        .send(payload)
        .expect(202);

      expect(response.body).toMatchObject({
        queued: true,
        sourceType: 'mock',
        sourceId: 'mock-123',
        projectId: 'test-project',
      });

      // Verify source methods were called
      expect(mockSource.calls.validateWebhook).toBe(1);
      expect(mockSource.calls.parseWebhook).toBe(1);
    });

    it('should return 404 for unknown source', async () => {
      const response = await request(app)
        .post('/webhooks/unknown')
        .send({})
        .expect(404);

      expect(response.body.error).toBe('Unknown source');
      expect(response.body.available).toEqual(['mock']);
    });

    it('should return 401 for invalid signature', async () => {
      mockSource.setValidation(false);

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
        reason: 'Event filtered by source plugin',
      });
    });

    it('should respect shouldProcess filter', async () => {
      mockSource.shouldProcessResult = false;

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

    it('should handle source errors gracefully', async () => {
      // Make parseWebhook throw an error
      mockSource.parseWebhook = jest.fn().mockRejectedValue(new Error('Parse error'));

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

    it('should return empty list when no sources configured', async () => {
      sources.length = 0;

      const response = await request(app)
        .get('/webhooks')
        .expect(200);

      expect(response.body.endpoints).toEqual([]);
    });
  });
});
