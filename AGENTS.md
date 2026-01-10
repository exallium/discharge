# Custom Agents & Components

This document describes how to create custom agents and components to extend the Claude Agent system.

## Table of Contents

1. [Source Plugins](#source-plugins)
2. [Testing Your Agent](#testing-your-agent)
3. [Example Implementations](#example-implementations)
4. [Best Practices](#best-practices)

---

## Source Plugins

Source plugins are the primary extension point for adding new bug sources (Sentry, GitHub, Linear, Jira, etc.).

### Interface

All source plugins implement the `SourcePlugin` interface:

```typescript
interface SourcePlugin {
  // Identification
  id: string;                    // Unique identifier (e.g., 'sentry', 'github-issues')
  type: string;                  // Type name for internal routing

  // Webhook handling
  validateWebhook(req: Request): Promise<boolean>;
  parseWebhook(payload: any): Promise<SourceEvent | null>;

  // Tool generation
  getTools(event: SourceEvent): Tool[];

  // Context generation
  getPromptContext(event: SourceEvent): string;

  // Post-processing
  updateStatus(event: SourceEvent, status: FixStatus): Promise<void>;
  addComment(event: SourceEvent, comment: string): Promise<void>;
  getLink(event: SourceEvent): string;

  // Optional: Pre-filtering
  shouldProcess?(event: SourceEvent): Promise<boolean>;
}
```

### Creating a New Source Plugin

#### 1. Create Plugin File

Create a new file in `router/src/sources/your-source.ts`:

```typescript
import { Request } from 'express';
import { SourcePlugin, SourceEvent, Tool, FixStatus } from './base';

export class YourSource implements SourcePlugin {
  id = 'your-source';
  type = 'your-source';

  async validateWebhook(req: Request): Promise<boolean> {
    // Verify webhook signature/authentication
    // Return true if valid, false otherwise
    const signature = req.headers['x-your-signature'];
    if (!signature) return false;

    // Implement your signature verification
    return this.verifySignature(req.body, signature);
  }

  async parseWebhook(payload: any): Promise<SourceEvent | null> {
    // Parse webhook payload into normalized SourceEvent
    // Return null to ignore the webhook

    // Example: only handle specific actions
    if (payload.action !== 'created') {
      return null;
    }

    // Map to your project configuration
    const project = this.findProject(payload);
    if (!project) {
      return null;
    }

    return {
      sourceType: 'your-source',
      sourceId: payload.issue.id,
      projectId: project.id,
      title: payload.issue.title,
      description: payload.issue.description,
      metadata: {
        severity: this.mapSeverity(payload.issue.priority),
        tags: payload.issue.labels || [],
        environment: payload.environment,
      },
      links: {
        web: payload.issue.url,
        api: payload.issue.api_url,
      },
      raw: payload,
    };
  }

  getTools(event: SourceEvent): Tool[] {
    // Return bash scripts that Claude can use to investigate
    return [
      {
        name: 'get-issue-details',
        description: 'Get full issue details including comments',
        script: `#!/bin/bash
set -e
curl -s "https://api.yourservice.com/issues/${event.sourceId}" \\
  -H "Authorization: Bearer \${YOUR_SERVICE_TOKEN}" \\
  | jq '{
    id: .id,
    title: .title,
    description: .description,
    comments: .comments,
    metadata: .metadata
  }'
`,
      },
      {
        name: 'get-related-issues',
        description: 'Get related or similar issues',
        script: `#!/bin/bash
set -e
curl -s "https://api.yourservice.com/issues/${event.sourceId}/related" \\
  -H "Authorization: Bearer \${YOUR_SERVICE_TOKEN}" \\
  | jq '.[]'
`,
      },
    ];
  }

  getPromptContext(event: SourceEvent): string {
    // Return formatted context for Claude's prompt
    return `**Issue:** ${event.title}
**Description:** ${event.description}
**Severity:** ${event.metadata.severity}
**Environment:** ${event.metadata.environment}
**Link:** ${event.links?.web}`;
  }

  async updateStatus(event: SourceEvent, status: FixStatus): Promise<void> {
    // Update the issue status in your service
    if (status.fixed) {
      await fetch(`https://api.yourservice.com/issues/${event.sourceId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${process.env.YOUR_SERVICE_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          status: 'resolved',
          resolution: 'auto-fixed',
        }),
      });
    }
  }

  async addComment(event: SourceEvent, comment: string): Promise<void> {
    // Add a comment to the issue
    await fetch(`https://api.yourservice.com/issues/${event.sourceId}/comments`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.YOUR_SERVICE_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ body: comment }),
    });
  }

  getLink(event: SourceEvent): string {
    // Return markdown link for PR descriptions
    return `[Issue #${event.sourceId}](${event.links?.web})`;
  }

  // Optional: Pre-filtering
  async shouldProcess(event: SourceEvent): Promise<boolean> {
    // Add custom logic to decide if this event should be processed
    // Example: only process high severity issues
    return event.metadata.severity === 'high' || event.metadata.severity === 'critical';
  }

  // Private helper methods
  private verifySignature(body: any, signature: string): boolean {
    // Implement signature verification
    return true;
  }

  private findProject(payload: any): any {
    // Find matching project configuration
    return null;
  }

  private mapSeverity(priority: string): 'low' | 'medium' | 'high' | 'critical' {
    const map: Record<string, any> = {
      'p0': 'critical',
      'p1': 'high',
      'p2': 'medium',
      'p3': 'low',
    };
    return map[priority] || 'medium';
  }
}
```

#### 2. Register Plugin

Add your plugin to `router/src/sources/index.ts`:

```typescript
import { YourSource } from './your-source';

export const sources: SourcePlugin[] = [
  new YourSource(),
  // ... other sources
];
```

#### 3. Configure Environment

Add required tokens to `.env`:

```bash
YOUR_SERVICE_TOKEN=your-api-token-here
```

Update `docker-compose.yml` to pass the token:

```yaml
services:
  router:
    environment:
      - YOUR_SERVICE_TOKEN=${YOUR_SERVICE_TOKEN}
```

#### 4. Configure Projects

Add source configuration to `router/src/config/projects.ts`:

```typescript
export const projects: ProjectConfig[] = [
  {
    id: 'my-app',
    repo: 'git@github.com:owner/my-app.git',
    repoFullName: 'owner/my-app',
    branch: 'main',
    triggers: {
      'your-source': {
        projectSlug: 'my-app-prod',
        enabled: true,
      },
    },
  },
];
```

#### 5. Configure Webhook

In your service, configure webhook to point to:
```
https://your-domain.com/webhooks/your-source
```

---

## Testing Your Agent

### Unit Tests

Create a test file at `router/tests/unit/sources/your-source.test.ts`:

```typescript
import { YourSource } from '../../../src/sources/your-source';
import { mockWebhookPayloads } from '../../fixtures/webhook-payloads';

describe('YourSource', () => {
  let source: YourSource;

  beforeEach(() => {
    source = new YourSource();
  });

  describe('validateWebhook', () => {
    it('should validate webhook with correct signature', async () => {
      const req = {
        headers: { 'x-your-signature': 'valid-signature' },
        body: { /* ... */ },
      } as any;

      const result = await source.validateWebhook(req);
      expect(result).toBe(true);
    });

    it('should reject webhook with invalid signature', async () => {
      const req = {
        headers: { 'x-your-signature': 'invalid' },
        body: { /* ... */ },
      } as any;

      const result = await source.validateWebhook(req);
      expect(result).toBe(false);
    });
  });

  describe('parseWebhook', () => {
    it('should parse valid webhook', async () => {
      const payload = { /* ... */ };
      const event = await source.parseWebhook(payload);

      expect(event).toBeTruthy();
      expect(event?.sourceType).toBe('your-source');
    });

    it('should return null for ignored events', async () => {
      const payload = { action: 'deleted' };
      const event = await source.parseWebhook(payload);

      expect(event).toBeNull();
    });
  });

  describe('getTools', () => {
    it('should return investigation tools', () => {
      const event = {
        sourceType: 'your-source',
        sourceId: '123',
        projectId: 'test',
        title: 'Test',
        description: 'Test',
        metadata: {},
        raw: {},
      };

      const tools = source.getTools(event);

      expect(tools.length).toBeGreaterThan(0);
      expect(tools[0]).toHaveProperty('name');
      expect(tools[0]).toHaveProperty('script');
      expect(tools[0]).toHaveProperty('description');
    });
  });

  describe('updateStatus', () => {
    it('should update issue status when fixed', async () => {
      const event = { /* ... */ };
      const status = { fixed: true };

      // Mock fetch
      global.fetch = jest.fn().mockResolvedValue({ ok: true });

      await source.updateStatus(event, status);

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/issues/'),
        expect.objectContaining({ method: 'PATCH' })
      );
    });
  });
});
```

### Integration Tests

Add webhook payload fixture to `router/tests/fixtures/webhook-payloads.ts`:

```typescript
export const mockWebhookPayloads = {
  // ... existing payloads

  'your-source': {
    issueCreated: {
      action: 'created',
      issue: {
        id: '123',
        title: 'Bug in production',
        description: 'Users cannot log in',
        priority: 'p0',
        labels: ['bug', 'production'],
        url: 'https://yourservice.com/issues/123',
      },
      environment: 'production',
    },
    issueResolved: {
      action: 'resolved',
      issue: { id: '123' },
    },
  },
};
```

Create integration test at `router/tests/integration/your-source.test.ts`:

```typescript
import request from 'supertest';
import { createTestApp } from '../helpers/app';
import { YourSource } from '../../src/sources/your-source';
import { sources } from '../../src/sources';
import { mockWebhookPayloads } from '../fixtures/webhook-payloads';

describe('YourSource Integration', () => {
  const app = createTestApp();

  beforeAll(() => {
    sources.push(new YourSource());
  });

  it('should process webhook end-to-end', async () => {
    const payload = mockWebhookPayloads['your-source'].issueCreated;

    const response = await request(app)
      .post('/webhooks/your-source')
      .send(payload)
      .expect(202);

    expect(response.body.queued).toBe(true);
    expect(response.body.sourceType).toBe('your-source');
  });
});
```

### Manual Testing

Test webhook locally using curl:

```bash
# Start the router
npm run dev

# Send test webhook
curl -X POST http://localhost:3000/webhooks/your-source \
  -H "Content-Type: application/json" \
  -H "X-Your-Signature: test-signature" \
  -d '{
    "action": "created",
    "issue": {
      "id": "123",
      "title": "Test Issue",
      "description": "Test description"
    }
  }'
```

---

## Example Implementations

### Minimal Source Plugin

Simplest possible implementation:

```typescript
import { SourcePlugin, SourceEvent, Tool, FixStatus } from './base';

export class MinimalSource implements SourcePlugin {
  id = 'minimal';
  type = 'minimal';

  async validateWebhook() { return true; }

  async parseWebhook(payload: any): Promise<SourceEvent | null> {
    if (!payload.id) return null;

    return {
      sourceType: 'minimal',
      sourceId: payload.id,
      projectId: 'default',
      title: payload.title || 'Untitled',
      description: payload.description || '',
      metadata: {},
      raw: payload,
    };
  }

  getTools() { return []; }
  getPromptContext(event: SourceEvent) { return event.title; }
  async updateStatus() {}
  async addComment() {}
  getLink(event: SourceEvent) { return event.sourceId; }
}
```

### Sentry Source Plugin

Full-featured example (see implementation in plan):

```typescript
export class SentrySource implements SourcePlugin {
  id = 'sentry';
  type = 'sentry';

  async validateWebhook(req: Request): Promise<boolean> {
    // Sentry doesn't sign webhooks, could verify IP ranges
    return true;
  }

  async parseWebhook(payload: any): Promise<SourceEvent | null> {
    if (payload.action !== 'created') return null;

    const project = findProjectBySentrySlug(payload.project.slug);
    if (!project?.triggers.sentry?.enabled) return null;

    return {
      sourceType: 'sentry',
      sourceId: payload.data.issue.id,
      projectId: project.id,
      title: payload.data.issue.title,
      description: payload.data.issue.culprit,
      metadata: {
        severity: this.mapLevel(payload.data.issue.level),
        tags: payload.data.issue.tags?.map(t => `${t.key}:${t.value}`),
        environment: payload.data.issue.metadata.type,
      },
      links: {
        web: `https://sentry.io/issues/${payload.data.issue.id}/`,
        api: `https://sentry.io/api/0/issues/${payload.data.issue.id}/`,
      },
      raw: payload,
    };
  }

  getTools(event: SourceEvent): Tool[] {
    return [
      {
        name: 'get-issue-details',
        description: 'Get full issue details',
        script: `curl -s "https://sentry.io/api/0/issues/${event.sourceId}/" ...`,
      },
      {
        name: 'get-events',
        description: 'Get recent error events with stack traces',
        script: `curl -s "https://sentry.io/api/0/issues/${event.sourceId}/events/" ...`,
      },
    ];
  }

  // ... rest of implementation
}
```

### GitHub Issues Source Plugin

```typescript
import crypto from 'crypto';

export class GitHubIssuesSource implements SourcePlugin {
  id = 'github-issues';
  type = 'github-issues';

  async validateWebhook(req: Request): Promise<boolean> {
    const signature = req.headers['x-hub-signature-256'] as string;
    const secret = process.env.GITHUB_WEBHOOK_SECRET;

    if (!signature || !secret) return false;

    const body = JSON.stringify(req.body);
    const expected = 'sha256=' +
      crypto.createHmac('sha256', secret)
        .update(body)
        .digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected)
    );
  }

  async parseWebhook(payload: any): Promise<SourceEvent | null> {
    if (payload.action !== 'opened') return null;

    const project = findProjectByRepo(payload.repository.full_name);
    if (!project?.triggers.github?.issues) return null;

    // Check label filters
    const labels = payload.issue.labels?.map(l => l.name) || [];
    const required = project.triggers.github.labels;
    if (required?.length && !required.some(l => labels.includes(l))) {
      return null;
    }

    return {
      sourceType: 'github-issues',
      sourceId: payload.issue.number.toString(),
      projectId: project.id,
      title: payload.issue.title,
      description: payload.issue.body || '',
      metadata: {
        tags: labels,
        user: payload.issue.user.login,
      },
      links: {
        web: payload.issue.html_url,
        api: payload.issue.url,
      },
      raw: payload,
    };
  }

  getTools(event: SourceEvent): Tool[] {
    const [owner, repo] = event.raw.repository.full_name.split('/');
    return [
      {
        name: 'get-issue',
        description: 'Get issue details and comments',
        script: `#!/bin/bash
curl -s "https://api.github.com/repos/${owner}/${repo}/issues/${event.sourceId}" \\
  -H "Authorization: Bearer \${GITHUB_TOKEN}"
`,
      },
    ];
  }

  // ... rest of implementation
}
```

---

## Best Practices

### 1. Error Handling

Always handle errors gracefully:

```typescript
async parseWebhook(payload: any): Promise<SourceEvent | null> {
  try {
    // Parsing logic
    return event;
  } catch (error) {
    console.error(`Failed to parse webhook:`, error);
    return null; // Gracefully ignore malformed webhooks
  }
}
```

### 2. Validation

Validate all required fields:

```typescript
async parseWebhook(payload: any): Promise<SourceEvent | null> {
  if (!payload.issue?.id || !payload.issue?.title) {
    return null; // Missing required fields
  }
  // Continue parsing...
}
```

### 3. Security

- Always verify webhook signatures when available
- Use environment variables for sensitive tokens
- Validate IP addresses if the service provides webhook IPs
- Never log sensitive data (tokens, credentials)

```typescript
async validateWebhook(req: Request): Promise<boolean> {
  // Verify signature
  const signature = req.headers['x-signature'];
  if (!this.isValidSignature(req.body, signature)) {
    console.warn('Invalid webhook signature');
    return false;
  }
  return true;
}
```

### 4. Rate Limiting

Consider implementing rate limiting for external API calls:

```typescript
private rateLimiter = new RateLimiter({ requests: 100, per: 60000 });

async updateStatus(event: SourceEvent, status: FixStatus): Promise<void> {
  await this.rateLimiter.wait();
  // Make API call
}
```

### 5. Tool Scripts

Make tools robust and informative:

```typescript
getTools(event: SourceEvent): Tool[] {
  return [{
    name: 'get-issue',
    description: 'Usage: get-issue [--full] - Get issue details',
    script: `#!/bin/bash
set -e  # Exit on error

# Check for required env vars
if [ -z "\${API_TOKEN}" ]; then
  echo "Error: API_TOKEN not set" >&2
  exit 1
fi

# Make request with error handling
curl -f -s "https://api.example.com/issues/${event.sourceId}" \\
  -H "Authorization: Bearer \${API_TOKEN}" \\
  || { echo "Failed to fetch issue" >&2; exit 1; }
`,
  }];
}
```

### 6. Testing

- Write tests for all public methods
- Test error cases and edge cases
- Use fixtures for realistic data
- Mock external API calls in unit tests

### 7. Documentation

Document your source plugin:

```typescript
/**
 * Source plugin for YourService
 *
 * Webhook endpoint: POST /webhooks/your-source
 * Required env vars: YOUR_SERVICE_TOKEN
 *
 * Supported events:
 * - issue.created
 * - issue.updated (if priority changes)
 *
 * Configuration:
 * ```typescript
 * triggers: {
 *   'your-source': {
 *     projectSlug: 'project-name',
 *     enabled: true,
 *     minPriority: 'p1'  // Optional: minimum priority to process
 *   }
 * }
 * ```
 */
export class YourSource implements SourcePlugin {
  // ...
}
```

### 8. Logging

Use structured logging:

```typescript
async parseWebhook(payload: any): Promise<SourceEvent | null> {
  console.log('[your-source] Parsing webhook', {
    action: payload.action,
    issueId: payload.issue?.id,
  });

  // ... parsing logic

  if (!event) {
    console.log('[your-source] Event filtered', {
      reason: 'action not supported',
      action: payload.action,
    });
    return null;
  }

  return event;
}
```

---

## Additional Extension Points

### Custom Analysis Strategies (Future)

```typescript
interface AnalysisStrategy {
  shouldAutoFix(analysis: AnalysisResult): boolean;
  getConfidenceThreshold(): 'high' | 'medium' | 'low';
}
```

### Custom Notification Handlers (Future)

```typescript
interface NotificationHandler {
  sendNotification(message: string, metadata?: any): Promise<void>;
}
```

### Custom Tool Generators (Future)

```typescript
interface ToolGenerator {
  generateTools(event: SourceEvent): Tool[];
}
```

---

## Getting Help

- Review existing source implementations in `router/src/sources/`
- Check test examples in `router/tests/unit/sources/`
- See webhook payload fixtures in `router/tests/fixtures/`
- Read the main architecture doc: [GENERIC_ARCHITECTURE.md](./GENERIC_ARCHITECTURE.md)

---

## Contributing

When contributing a new source plugin:

1. Implement the `SourcePlugin` interface
2. Add comprehensive tests (unit + integration)
3. Add webhook payload fixtures
4. Document configuration and environment variables
5. Update this guide with your example
6. Submit a PR with all changes

Your source plugin makes the system more valuable for everyone!
