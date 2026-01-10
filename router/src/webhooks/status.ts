import { Router } from 'express';
import { listTriggerIds } from '../triggers';
import { getQueueStats } from '../queue';

export const statusRouter = Router();

/**
 * JSON status endpoint
 */
statusRouter.get('/status', async (req, res) => {
  const queue = await getQueueStats();

  res.json({
    status: 'running',
    triggers: listTriggerIds(),
    queue,
    timestamp: new Date().toISOString(),
  });
});

/**
 * Simple HTML dashboard
 */
statusRouter.get('/dashboard', async (req, res) => {
  const triggers = listTriggerIds();
  const queue = await getQueueStats();

  res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>Claude Agent Status</title>
  <meta http-equiv="refresh" content="30">
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 800px;
      margin: 2rem auto;
      padding: 1rem;
      background: #f5f5f5;
    }
    h1 { margin-bottom: 0.5rem; }
    .subtitle { color: #666; margin-bottom: 2rem; }
    .card {
      background: white;
      padding: 1.5rem;
      border-radius: 8px;
      margin-bottom: 1rem;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .status-ok { border-left: 4px solid #22c55e; }
    .status-error { border-left: 4px solid #ef4444; }
    .label { font-weight: 600; color: #666; margin-bottom: 0.5rem; }
    .value { font-size: 1.25rem; margin: 0.5rem 0; }
    .code {
      background: #f9f9f9;
      padding: 0.5rem;
      border-radius: 4px;
      font-family: monospace;
      font-size: 0.875rem;
      margin: 0.5rem 0;
    }
    .meta { color: #999; font-size: 0.75rem; margin-top: 1rem; text-align: center; }
    ul { list-style: none; padding: 0; }
    li { padding: 0.5rem 0; border-bottom: 1px solid #eee; }
    li:last-child { border-bottom: none; }
  </style>
</head>
<body>
  <h1>🤖 Claude Agent</h1>
  <div class="subtitle">Automated Bug Fixing System</div>

  <div class="card status-ok">
    <div class="label">System Status</div>
    <div class="value">✅ Running</div>
  </div>

  <div class="card ${queue.paused ? 'status-error' : 'status-ok'}">
    <div class="label">Job Queue</div>
    <div class="value">${queue.paused ? '⏸️ Paused' : '▶️ Running'}</div>
    <ul>
      <li><strong>Waiting:</strong> ${queue.waiting}</li>
      <li><strong>Active:</strong> ${queue.active}</li>
      <li><strong>Completed:</strong> ${queue.completed}</li>
      <li><strong>Failed:</strong> ${queue.failed}</li>
      ${queue.delayed > 0 ? `<li><strong>Delayed:</strong> ${queue.delayed}</li>` : ''}
    </ul>
  </div>

  <div class="card">
    <div class="label">Configured Triggers (${triggers.length})</div>
    ${triggers.length > 0 ? `
      <ul>
        ${triggers.map(id => `
          <li>
            <strong>${id}</strong>
            <div class="code">POST /webhooks/${id}</div>
          </li>
        `).join('')}
      </ul>
    ` : '<p>No triggers configured yet.</p>'}
  </div>

  <div class="card">
    <div class="label">Quick Links</div>
    <ul>
      <li><a href="/health">Health Check (JSON)</a></li>
      <li><a href="/status">Status (JSON)</a></li>
      <li><a href="/webhooks">Webhook Endpoints (JSON)</a></li>
    </ul>
  </div>

  <div class="meta">
    Auto-refreshes every 30 seconds<br>
    Last updated: ${new Date().toLocaleString()}
  </div>
</body>
</html>
  `);
});
