import { Router } from 'express';
import { getSourceById, listSourceIds } from '../sources';
import { queueFixJob } from '../queue';

export const webhookRouter = Router();

/**
 * Generic webhook endpoint: POST /webhooks/:sourceId
 * Each source plugin handles its own webhook validation and parsing
 */
webhookRouter.post('/:sourceId', async (req, res) => {
  const sourceId = req.params.sourceId;
  const source = getSourceById(sourceId);

  // Check if source exists
  if (!source) {
    return res.status(404).json({
      error: 'Unknown source',
      available: listSourceIds()
    });
  }

  try {
    // Validate webhook signature/authentication
    const isValid = await source.validateWebhook(req);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }

    // Parse webhook payload into normalized event
    const event = await source.parseWebhook(req.body);
    if (!event) {
      return res.status(200).json({
        ignored: true,
        reason: 'Event filtered by source plugin'
      });
    }

    // Optional pre-processing filter
    if (source.shouldProcess) {
      const shouldProcess = await source.shouldProcess(event);
      if (!shouldProcess) {
        return res.status(200).json({
          ignored: true,
          reason: 'Event filtered by shouldProcess'
        });
      }
    }

    // Queue the job
    const jobId = await queueFixJob({
      event,
      sourceType: source.type,
      queuedAt: new Date().toISOString(),
    });

    res.status(202).json({
      queued: true,
      jobId,
      sourceType: event.sourceType,
      sourceId: event.sourceId,
      projectId: event.projectId,
    });

  } catch (error: any) {
    console.error(`[${sourceId}] Webhook error:`, error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * List all available webhook endpoints
 */
webhookRouter.get('/', (req, res) => {
  const endpoints = listSourceIds().map(id => ({
    id,
    url: `/webhooks/${id}`,
    method: 'POST'
  }));

  res.json({
    message: 'Claude Agent Webhook Router',
    endpoints
  });
});
