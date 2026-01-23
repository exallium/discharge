# Custom Agents & Components

This document describes how to create custom agents and components to extend the Discharge system.

## Table of Contents

1. [Trigger Plugins](#trigger-plugins)
2. [Testing Your Agent](#testing-your-agent)
3. [Example Implementations](#example-implementations)
4. [Best Practices](#best-practices)
5. [Repository Configuration](#repository-configuration)

---

## Trigger Plugins

Trigger plugins are the primary extension point for adding new bug triggers (Sentry, GitHub, Linear, Jira, etc.).

### Interface

All trigger plugins implement the `TriggerPlugin` interface:

```typescript
interface TriggerPlugin {
  // Identification
  id: string;                    // Unique identifier (e.g., 'sentry', 'github-issues')
  type: string;                  // Type name for internal routing

  // Webhook handling
  validateWebhook(req: WebhookRequest): Promise<boolean>;
  parseWebhook(payload: any): Promise<TriggerEvent | null>;

  // Tool generation
  getTools(event: TriggerEvent): Tool[];

  // Context generation
  getPromptContext(event: TriggerEvent): string;

  // Post-processing
  updateStatus(event: TriggerEvent, status: FixStatus): Promise<void>;
  addComment(event: TriggerEvent, comment: string): Promise<void>;
  getLink(event: TriggerEvent): string;

  // Optional: Pre-filtering
  shouldProcess?(event: TriggerEvent): Promise<boolean>;
}
```

### Creating a New Source Plugin

#### 1. Create Plugin File

Create a new file in `router/src/triggers/your-trigger.ts`:

```typescript
import { TriggerPlugin, TriggerEvent, Tool, FixStatus, WebhookRequest } from './base';

export class YourTrigger implements TriggerPlugin {
  id = 'your-trigger';
  type = 'your-trigger';

  async validateWebhook(req: WebhookRequest): Promise<boolean> {
    // Verify webhook signature/authentication
    // Return true if valid, false otherwise
    const signature = req.headers['x-your-signature'];
    if (!signature) return false;

    // Implement your signature verification
    return this.verifySignature(req.body, signature);
  }

  async parseWebhook(payload: any): Promise<TriggerEvent | null> {
    // Parse webhook payload into normalized TriggerEvent
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
      triggerType: 'your-trigger',
      triggerId: payload.issue.id,
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

  getTools(event: TriggerEvent): Tool[] {
    // Return bash scripts that Claude can use to investigate
    return [
      {
        name: 'get-issue-details',
        description: 'Get full issue details including comments',
        script: `#!/bin/bash
set -e
curl -s "https://api.yourservice.com/issues/${event.triggerId}" \\
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
curl -s "https://api.yourservice.com/issues/${event.triggerId}/related" \\
  -H "Authorization: Bearer \${YOUR_SERVICE_TOKEN}" \\
  | jq '.[]'
`,
      },
    ];
  }

  getPromptContext(event: TriggerEvent): string {
    // Return formatted context for Claude's prompt
    return `**Issue:** ${event.title}
**Description:** ${event.description}
**Severity:** ${event.metadata.severity}
**Environment:** ${event.metadata.environment}
**Link:** ${event.links?.web}`;
  }

  async updateStatus(event: TriggerEvent, status: FixStatus): Promise<void> {
    // Update the issue status in your service
    if (status.fixed) {
      await fetch(`https://api.yourservice.com/issues/${event.triggerId}`, {
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

  async addComment(event: TriggerEvent, comment: string): Promise<void> {
    // Add a comment to the issue
    await fetch(`https://api.yourservice.com/issues/${event.triggerId}/comments`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.YOUR_SERVICE_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ body: comment }),
    });
  }

  getLink(event: TriggerEvent): string {
    // Return markdown link for PR descriptions
    return `[Issue #${event.triggerId}](${event.links?.web})`;
  }

  // Optional: Pre-filtering
  async shouldProcess(event: TriggerEvent): Promise<boolean> {
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

Add your plugin to `router/src/triggers/index.ts`:

```typescript
import { YourSource } from './your-trigger';

export const triggers: TriggerPlugin[] = [
  new YourTrigger(),
  // ... other triggers
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

Add trigger configuration to `router/src/config/projects.ts`:

```typescript
export const projects: ProjectConfig[] = [
  {
    id: 'my-app',
    repo: 'git@github.com:owner/my-app.git',
    repoFullName: 'owner/my-app',
    branch: 'main',
    triggers: {
      'your-trigger': {
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
https://your-domain.com/webhooks/your-trigger
```

---

## Testing Your Agent

### Unit Tests

Create a test file at `router/tests/unit/triggers/your-trigger.test.ts`:

```typescript
import { YourSource } from '../../../src/triggers/your-trigger';
import { mockWebhookPayloads } from '../../fixtures/webhook-payloads';

describe('YourSource', () => {
  let trigger: YourSource;

  beforeEach(() => {
    trigger = new YourTrigger();
  });

  describe('validateWebhook', () => {
    it('should validate webhook with correct signature', async () => {
      const req = {
        headers: { 'x-your-signature': 'valid-signature' },
        body: { /* ... */ },
      } as any;

      const result = await trigger.validateWebhook(req);
      expect(result).toBe(true);
    });

    it('should reject webhook with invalid signature', async () => {
      const req = {
        headers: { 'x-your-signature': 'invalid' },
        body: { /* ... */ },
      } as any;

      const result = await trigger.validateWebhook(req);
      expect(result).toBe(false);
    });
  });

  describe('parseWebhook', () => {
    it('should parse valid webhook', async () => {
      const payload = { /* ... */ };
      const event = await trigger.parseWebhook(payload);

      expect(event).toBeTruthy();
      expect(event?.triggerType).toBe('your-trigger');
    });

    it('should return null for ignored events', async () => {
      const payload = { action: 'deleted' };
      const event = await trigger.parseWebhook(payload);

      expect(event).toBeNull();
    });
  });

  describe('getTools', () => {
    it('should return investigation tools', () => {
      const event = {
        triggerType: 'your-trigger',
        triggerId: '123',
        projectId: 'test',
        title: 'Test',
        description: 'Test',
        metadata: {},
        raw: {},
      };

      const tools = trigger.getTools(event);

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

      await trigger.updateStatus(event, status);

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

  'your-trigger': {
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

Create integration test at `router/tests/integration/your-trigger.test.ts`:

```typescript
import request from 'supertest';
import { createTestApp } from '../helpers/app';
import { YourSource } from '../../src/triggers/your-trigger';
import { sources } from '../../src/triggers';
import { mockWebhookPayloads } from '../fixtures/webhook-payloads';

describe('YourSource Integration', () => {
  const app = createTestApp();

  beforeAll(() => {
    triggers.push(new YourTrigger());
  });

  it('should process webhook end-to-end', async () => {
    const payload = mockWebhookPayloads['your-trigger'].issueCreated;

    const response = await request(app)
      .post('/webhooks/your-trigger')
      .send(payload)
      .expect(202);

    expect(response.body.queued).toBe(true);
    expect(response.body.triggerType).toBe('your-trigger');
  });
});
```

### Manual Testing

Test webhook locally using curl:

```bash
# Start the router
npm run dev

# Send test webhook
curl -X POST http://localhost:3000/webhooks/your-trigger \
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
import { TriggerPlugin, TriggerEvent, Tool, FixStatus } from './base';

export class MinimalTrigger implements TriggerPlugin {
  id = 'minimal';
  type = 'minimal';

  async validateWebhook() { return true; }

  async parseWebhook(payload: any): Promise<TriggerEvent | null> {
    if (!payload.id) return null;

    return {
      triggerType: 'minimal',
      triggerId: payload.id,
      projectId: 'default',
      title: payload.title || 'Untitled',
      description: payload.description || '',
      metadata: {},
      raw: payload,
    };
  }

  getTools() { return []; }
  getPromptContext(event: TriggerEvent) { return event.title; }
  async updateStatus() {}
  async addComment() {}
  getLink(event: TriggerEvent) { return event.triggerId; }
}
```

### Sentry Source Plugin

Full-featured example (see implementation in plan):

```typescript
export class SentryTrigger implements TriggerPlugin {
  id = 'sentry';
  type = 'sentry';

  async validateWebhook(req: WebhookRequest): Promise<boolean> {
    // Sentry doesn't sign webhooks, could verify IP ranges
    return true;
  }

  async parseWebhook(payload: any): Promise<TriggerEvent | null> {
    if (payload.action !== 'created') return null;

    const project = findProjectBySentrySlug(payload.project.slug);
    if (!project?.triggers.sentry?.enabled) return null;

    return {
      triggerType: 'sentry',
      triggerId: payload.data.issue.id,
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

  getTools(event: TriggerEvent): Tool[] {
    return [
      {
        name: 'get-issue-details',
        description: 'Get full issue details',
        script: `curl -s "https://sentry.io/api/0/issues/${event.triggerId}/" ...`,
      },
      {
        name: 'get-events',
        description: 'Get recent error events with stack traces',
        script: `curl -s "https://sentry.io/api/0/issues/${event.triggerId}/events/" ...`,
      },
    ];
  }

  // ... rest of implementation
}
```

### GitHub Issues Source Plugin

```typescript
import crypto from 'crypto';

export class GitHubIssuesTrigger implements TriggerPlugin {
  id = 'github-issues';
  type = 'github-issues';

  async validateWebhook(req: WebhookRequest): Promise<boolean> {
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

  async parseWebhook(payload: any): Promise<TriggerEvent | null> {
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
      triggerType: 'github-issues',
      triggerId: payload.issue.number.toString(),
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

  getTools(event: TriggerEvent): Tool[] {
    const [owner, repo] = event.raw.repository.full_name.split('/');
    return [
      {
        name: 'get-issue',
        description: 'Get issue details and comments',
        script: `#!/bin/bash
curl -s "https://api.github.com/repos/${owner}/${repo}/issues/${event.triggerId}" \\
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
async parseWebhook(payload: any): Promise<TriggerEvent | null> {
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
async parseWebhook(payload: any): Promise<TriggerEvent | null> {
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
async validateWebhook(req: WebhookRequest): Promise<boolean> {
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

async updateStatus(event: TriggerEvent, status: FixStatus): Promise<void> {
  await this.rateLimiter.wait();
  // Make API call
}
```

### 5. Tool Scripts

Make tools robust and informative:

```typescript
getTools(event: TriggerEvent): Tool[] {
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
curl -f -s "https://api.example.com/issues/${event.triggerId}" \\
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

Document your trigger plugin:

```typescript
/**
 * Source plugin for YourService
 *
 * Webhook endpoint: POST /webhooks/your-trigger
 * Required env vars: YOUR_SERVICE_TOKEN
 *
 * Supported events:
 * - issue.created
 * - issue.updated (if priority changes)
 *
 * Configuration:
 * ```typescript
 * triggers: {
 *   'your-trigger': {
 *     projectSlug: 'project-name',
 *     enabled: true,
 *     minPriority: 'p1'  // Optional: minimum priority to process
 *   }
 * }
 * ```
 */
export class YourTrigger implements TriggerPlugin {
  // ...
}
```

### 8. Logging

Use structured logging:

```typescript
async parseWebhook(payload: any): Promise<TriggerEvent | null> {
  console.log('[your-trigger] Parsing webhook', {
    action: payload.action,
    issueId: payload.issue?.id,
  });

  // ... parsing logic

  if (!event) {
    console.log('[your-trigger] Event filtered', {
      reason: 'action not supported',
      action: payload.action,
    });
    return null;
  }

  return event;
}
```

---

## VCS Plugins

VCS (Version Control System) plugins are separate from trigger plugins. Trigger plugins handle bug tracking systems (Sentry, GitHub Issues), while VCS plugins handle code hosting platforms (GitHub, GitLab, Bitbucket).

### Why Separate?

A Sentry issue could be fixed in a GitLab repository. A Linear task could be fixed in a GitHub repository. Trigger and VCS are independent concerns.

### VCS Interface

```typescript
interface VCSPlugin {
  id: string;
  type: 'github' | 'gitlab' | 'bitbucket' | 'self-hosted';

  // Create a pull/merge request
  createPullRequest(
    owner: string,
    repo: string,
    head: string,
    base: string,
    title: string,
    body: string
  ): Promise<PullRequest>;

  // Get compare URL (fallback if PR creation fails)
  getCompareUrl(owner: string, repo: string, base: string, head: string): string;

  // Format repository identifier
  formatRepoIdentifier(owner: string, repo: string): string;

  // Validate configuration
  validate(): Promise<{ valid: boolean; error?: string }>;
}
```

### Creating a VCS Plugin

Example: GitLab VCS plugin

```typescript
import { VCSPlugin, PullRequest } from './base';
import { Gitlab } from '@gitbeaker/rest';

export class GitLabVCS implements VCSPlugin {
  id = 'gitlab';
  type = 'gitlab' as const;

  private client: InstanceType<typeof Gitlab>;

  constructor(token: string, host = 'https://gitlab.com') {
    this.client = new Gitlab({ host, token });
  }

  async createPullRequest(
    owner: string,
    repo: string,
    head: string,
    base: string,
    title: string,
    body: string
  ): Promise<PullRequest> {
    const projectId = `${owner}/${repo}`;

    const mr = await this.client.MergeRequests.create(
      projectId,
      head,
      base,
      title,
      { description: body }
    );

    return {
      number: mr.iid,
      url: mr.web_url,
      htmlUrl: mr.web_url,
      title: mr.title,
      body: mr.description || '',
      head,
      base,
    };
  }

  getCompareUrl(owner: string, repo: string, base: string, head: string): string {
    return `https://gitlab.com/${owner}/${repo}/-/compare/${base}...${head}`;
  }

  formatRepoIdentifier(owner: string, repo: string): string {
    return `${owner}/${repo}`;
  }

  async validate(): Promise<{ valid: boolean; error?: string }> {
    try {
      await this.client.Users.showCurrentUser();
      return { valid: true };
    } catch (error: any) {
      return {
        valid: false,
        error: error.message || 'GitLab authentication failed',
      };
    }
  }
}
```

### Registering VCS Plugin

Add to `router/src/vcs/index.ts`:

```typescript
import { GitLabVCS } from './gitlab';

export function initializeVCS(): void {
  // ... existing GitHub setup

  // GitLab VCS
  const gitlabToken = process.env.GITLAB_TOKEN;
  if (gitlabToken) {
    const gitlab = new GitLabVCS(gitlabToken, process.env.GITLAB_HOST);
    vcsPlugins.set('gitlab', gitlab);
    console.log('✓ GitLab VCS initialized');
  }
}
```

### Project Configuration

Specify VCS in project config:

```typescript
{
  id: 'my-app',
  repo: 'git@gitlab.com:mycompany/my-app.git',
  repoFullName: 'mycompany/my-app',
  branch: 'main',
  vcs: {
    type: 'gitlab',
    owner: 'mycompany',
    repo: 'my-app',
    reviewers: ['alice', 'bob'],
    labels: ['automated-fix']
  },
  triggers: {
    sentry: { projectSlug: 'my-app-prod', enabled: true }
  }
}
```

### Official Plugins

**GitHub VCS** (Included)
- Uses Octokit (@octokit/rest)
- Supports PAT and GitHub Apps
- Auto-add labels and reviewers
- Located: `router/src/vcs/github.ts`

**Future Official Plugins:**
- GitLab (using @gitbeaker/rest)
- Bitbucket (using @atlassian/bitbucket)
- Self-hosted Git (using direct API calls)

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
  generateTools(event: TriggerEvent): Tool[];
}
```

---

## Repository Configuration

Target repositories can include a `.discharge.json` file to customize how Claude investigates and fixes different types of bugs.

### Schema Reference

```typescript
interface BugFixConfig {
  version: string;                    // Schema version (currently "1")
  categories: {
    [name: string]: CategoryConfig;   // Named categories
  };
  constraints?: {
    excludePaths?: string[];          // Glob patterns to never modify
    requireTests?: boolean;           // Require tests to pass
    maxFilesChanged?: number;         // Max files Claude can modify
  };
}

interface CategoryConfig {
  match?: {
    labels?: string[];                // Labels that trigger this category
  };
  infrastructure?: {
    setup: string;                    // Command to start infrastructure
    teardown?: string;                // Command to stop infrastructure
    healthcheck?: string;             // Command to verify infrastructure ready
    timeout?: number;                 // Setup timeout in seconds (default: 120)
  };
  requirements: string[];             // Requirements shown to Claude
  deliverables: string[];             // Deliverables Claude must complete
  testCommand: string;                // Command to run tests
}
```

### Category Matching

Categories are matched by comparing issue labels against each category's `match.labels` array:

1. Labels are compared case-insensitively
2. First matching category wins
3. If no match, falls back to `default` category
4. If no `default`, uses base prompt without category requirements

### Infrastructure Lifecycle

When a category defines `infrastructure`:

1. **Setup**: Runs before Claude starts (e.g., `supabase start`)
2. **Healthcheck**: Runs after setup to verify readiness (optional)
3. **Claude executes**: Works on the bug with infrastructure available
4. **Teardown**: Runs in finally block, even if Claude fails (optional)

Infrastructure setup failures cause the job to fail immediately.

### Full Example

```json
{
  "version": "1",

  "categories": {
    "utility": {
      "match": { "labels": ["utility", "helper", "lib"] },
      "requirements": [
        "Run unit tests for affected modules",
        "Verify fix addresses the root cause"
      ],
      "deliverables": ["unit tests pass"],
      "testCommand": "npm test"
    },

    "database": {
      "match": { "labels": ["database", "postgres", "migration", "supabase"] },
      "infrastructure": {
        "setup": "supabase start",
        "teardown": "supabase stop",
        "healthcheck": "supabase status",
        "timeout": 120
      },
      "requirements": [
        "Verify migration is reversible (up and down)",
        "Check query performance with EXPLAIN ANALYZE",
        "Test with realistic data volume"
      ],
      "deliverables": ["migration up/down works", "no N+1 queries"],
      "testCommand": "npm run test:db"
    },

    "integration": {
      "match": { "labels": ["integration", "e2e", "api"] },
      "infrastructure": {
        "setup": "supabase start && npm run seed:test",
        "teardown": "supabase stop"
      },
      "requirements": [
        "Verify request/response contracts",
        "Run full integration test suite",
        "Check for breaking API changes"
      ],
      "deliverables": ["integration tests pass", "no breaking changes"],
      "testCommand": "npm run test:integration"
    },

    "ui": {
      "match": { "labels": ["ui", "frontend", "component", "visual"] },
      "requirements": [
        "Run component tests for affected components",
        "Verify no visual regressions",
        "Check accessibility (no new a11y violations)"
      ],
      "deliverables": ["component tests pass", "no console errors"],
      "testCommand": "npm run test:components"
    },

    "default": {
      "requirements": [
        "Run unit tests",
        "Verify fix addresses the issue described"
      ],
      "deliverables": ["unit tests pass"],
      "testCommand": "npm test"
    }
  },

  "constraints": {
    "excludePaths": [".env*", "secrets/", "*.key", "*.pem"],
    "requireTests": true,
    "maxFilesChanged": 10
  }
}
```

### Using Different Infrastructure Per Category

A common pattern is having different test environments for different bug types:

```json
{
  "categories": {
    "database": {
      "match": { "labels": ["database"] },
      "infrastructure": {
        "setup": "cd supabase-db && supabase start",
        "teardown": "cd supabase-db && supabase stop"
      },
      "testCommand": "npm run test:db"
    },
    "integration": {
      "match": { "labels": ["integration"] },
      "infrastructure": {
        "setup": "cd supabase-integration && supabase start",
        "teardown": "cd supabase-integration && supabase stop"
      },
      "testCommand": "npm run test:integration"
    }
  }
}
```

This allows database unit tests to use a minimal schema, while integration tests use a fully seeded environment.

---

## Getting Help

- Review existing source implementations in `router/src/triggers/`
- Check test examples in `router/tests/unit/triggers/`
- See webhook payload fixtures in `router/tests/fixtures/`
- Read the main architecture doc: [ARCHITECTURE.md](./ARCHITECTURE.md)

---

## Contributing

When contributing a new trigger plugin:

1. Implement the `TriggerPlugin` interface
2. Add comprehensive tests (unit + integration)
3. Add webhook payload fixtures
4. Document configuration and environment variables
5. Update this guide with your example
6. Submit a PR with all changes

Your trigger plugin makes the system more valuable for everyone!
