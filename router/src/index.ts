import express from 'express';
import dotenv from 'dotenv';
import { webhookRouter } from './webhooks';
import { statusRouter } from './webhooks/status';

// Load environment variables
dotenv.config();

const app = express();

// Middleware
app.use(express.json());

// Routes
app.use('/webhooks', webhookRouter);
app.use('/', statusRouter);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
async function main() {
  const port = process.env.PORT || 3000;

  app.listen(port, () => {
    console.log(`🤖 Claude Agent Router listening on port ${port}`);
    console.log(`📊 Health check: http://localhost:${port}/health`);
    console.log(`📈 Status dashboard: http://localhost:${port}/dashboard`);
  });
}

main().catch(error => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
