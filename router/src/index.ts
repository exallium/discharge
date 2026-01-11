import express from 'express';
import dotenv from 'dotenv';
import { webhookRouter } from './webhooks';
import { statusRouter } from './webhooks/status';
import { initializeQueue, closeQueue } from './queue';
import { createWorker, shutdownWorker } from './queue/worker';
import { initializeVCS } from './vcs';
import { initRunners } from './runner';
import { Worker } from 'bullmq';
import { healthCheck, readinessCheck, livenessCheck } from './health';
import { logger, requestLogger, logUnhandledErrors } from './logger';
import { validateEnvOrExit } from './env-validator';
import { webhookRateLimiter, apiRateLimiter, healthCheckRateLimiter } from './rate-limiter';

// Load environment variables
dotenv.config();

// Setup error logging
logUnhandledErrors();

// Validate environment configuration
validateEnvOrExit();

const app = express();
let worker: Worker;

// Middleware
app.use(express.json());
app.use(requestLogger());

// Routes
app.use('/webhooks', webhookRateLimiter, webhookRouter);
app.use('/', apiRateLimiter, statusRouter);

// Health check endpoints (with lenient rate limiting)
app.get('/health', healthCheckRateLimiter, healthCheck);
app.get('/ready', healthCheckRateLimiter, readinessCheck);
app.get('/live', healthCheckRateLimiter, livenessCheck);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Request error', {
    error: err.message,
    stack: err.stack,
    method: req.method,
    url: req.url,
  });
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
async function main() {
  // Initialize VCS plugins
  initializeVCS();

  // Initialize runner plugins
  initRunners();

  // Initialize queue
  await initializeQueue();

  // Start worker
  const concurrency = parseInt(process.env.WORKER_CONCURRENCY || '2');
  worker = createWorker(concurrency);

  // Start HTTP server
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    logger.info('AI Bug Fixer Router started', {
      port,
      nodeEnv: process.env.NODE_ENV || 'development',
      endpoints: {
        health: `http://localhost:${port}/health`,
        ready: `http://localhost:${port}/ready`,
        live: `http://localhost:${port}/live`,
        dashboard: `http://localhost:${port}/dashboard`,
      },
    });
  });
}

// Graceful shutdown
async function shutdown() {
  logger.info('Shutting down gracefully...');

  if (worker) {
    await shutdownWorker(worker);
  }

  await closeQueue();

  logger.info('Shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

main().catch(error => {
  logger.error('Failed to start server', {
    error: error.message,
    stack: error.stack,
  });
  process.exit(1);
});
