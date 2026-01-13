/**
 * Standalone Worker Process
 *
 * This runs as a separate process from the Next.js web server.
 * It processes BullMQ jobs from the queue.
 */

import dotenv from 'dotenv';
import { Worker } from 'bullmq';
import { initializeDatabase, closeDatabase } from './db';
import { initializeQueue, closeQueue } from './queue';
import { createWorker, shutdownWorker } from './queue/worker';
import { initializeVCS } from './vcs';
import { initRunners } from './runner';
import { logger, logUnhandledErrors } from './logger';
import { validateEnvOrExit } from './env-validator';

// Load environment variables
dotenv.config();

// Setup error logging
logUnhandledErrors();

// Validate environment configuration
validateEnvOrExit();

let worker: Worker;

async function main() {
  logger.info('Starting AI Bug Fixer Worker Process');

  // Initialize database
  await initializeDatabase();
  logger.info('Database initialized');

  // Initialize VCS plugins
  initializeVCS();
  logger.info('VCS plugins initialized');

  // Initialize runner plugins
  initRunners();
  logger.info('Runner plugins initialized');

  // Initialize queue
  await initializeQueue();
  logger.info('Queue initialized');

  // Start worker
  const concurrency = parseInt(process.env.WORKER_CONCURRENCY || '2');
  worker = createWorker(concurrency);

  logger.info('Worker started', {
    concurrency,
    queue: 'claude-fix-jobs',
    nodeEnv: process.env.NODE_ENV || 'development',
  });
}

// Graceful shutdown
async function shutdown(signal: string) {
  logger.info(`Received ${signal}, shutting down gracefully...`);

  if (worker) {
    await shutdownWorker(worker);
  }

  await closeQueue();
  await closeDatabase();

  logger.info('Worker shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

main().catch((error) => {
  logger.error('Failed to start worker', {
    error: error.message,
    stack: error.stack,
  });
  process.exit(1);
});
