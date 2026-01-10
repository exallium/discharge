import { Router } from 'express';
import { getTriggerById, listTriggerIds } from '../triggers';
import { queueFixJob } from '../queue';

export const webhookRouter = Router();

/**
 * Generic webhook endpoint: POST /webhooks/:triggerId
 * Each trigger plugin handles its own webhook validation and parsing
 */
webhookRouter.post('/:triggerId', async (req, res) => {
  const triggerId = req.params.triggerId;
  const trigger = getTriggerById(triggerId);

  // Check if trigger exists
  if (!trigger) {
    return res.status(404).json({
      error: 'Unknown trigger',
      available: listTriggerIds()
    });
  }

  try {
    // Validate webhook signature/authentication
    const isValid = await trigger.validateWebhook(req);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }

    // Parse webhook payload into normalized event
    const event = await trigger.parseWebhook(req.body);
    if (!event) {
      return res.status(200).json({
        ignored: true,
        reason: 'Event filtered by trigger plugin'
      });
    }

    // Optional pre-processing filter
    if (trigger.shouldProcess) {
      const shouldProcess = await trigger.shouldProcess(event);
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
      triggerType: trigger.type,
      queuedAt: new Date().toISOString(),
    });

    res.status(202).json({
      queued: true,
      jobId,
      triggerType: event.triggerType,
      triggerId: event.triggerId,
      projectId: event.projectId,
    });

  } catch (error: any) {
    console.error(`[${triggerId}] Webhook error:`, error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * List all available webhook endpoints
 */
webhookRouter.get('/', (req, res) => {
  const endpoints = listTriggerIds().map(id => ({
    id,
    url: `/webhooks/${id}`,
    method: 'POST'
  }));

  res.json({
    message: 'Claude Agent Webhook Router',
    endpoints
  });
});
