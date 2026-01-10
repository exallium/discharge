# Claude Agent Implementation Plan

A self-hosted automation system that uses Claude Code to automatically investigate and fix bugs from Sentry, GitHub Issues, and CircleCI test failures.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Prerequisites](#prerequisites)
3. [Directory Structure](#directory-structure)
4. [Core Components](#core-components)
5. [Docker Configuration](#docker-configuration)
6. [Webhook Handlers](#webhook-handlers)
7. [Job Queue System](#job-queue-system)
8. [Claude Runner](#claude-runner)
9. [API Tools for Claude](#api-tools-for-claude)
10. [Analysis & Fix Flow](#analysis--fix-flow)
11. [Auth Health Monitoring](#auth-health-monitoring)
12. [Cloudflare Tunnel Setup](#cloudflare-tunnel-setup)
13. [Deployment Checklist](#deployment-checklist)
14. [Maintenance & Operations](#maintenance--operations)

---

## Architecture Overview

```
                         Internet
                            │
                   Cloudflare Tunnel
                            │
              ┌─────────────┴─────────────┐
              │                           │
        agent.domain.com          portainer.domain.com
              │                    logs.domain.com
              │                           │
              ▼                           ▼
┌─────────────────────────────────────────────────────────┐
│                    Docker Network                        │
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐ │
│  │  Router  │──│  Redis   │  │ Portainer│  │ Dozzle  │ │
│  │ Service  │  │  Queue   │  │    UI    │  │  Logs   │ │
│  └────┬─────┘  └──────────┘  └──────────┘  └─────────┘ │
│       │                                                  │
│       │ spawns via docker.sock                          │
│       ▼                                                  │
│  ┌──────────────────────────────────────────────────┐   │
│  │              Claude Runner Container              │   │
│  │                                                   │   │
│  │  /workspace (cloned repo)                        │   │
│  │  /tools (API CLI tools)                          │   │
│  │  ~/.claude (mounted credentials)                 │   │
│  │                                                   │   │
│  │  Claude Code CLI with --dangerously-skip-perms   │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
└─────────────────────────────────────────────────────────┘
                            │
                       Mac Mini M2
                   (OrbStack runtime)
```

### Data Flow

1. **Webhook received** → Router validates signature, extracts payload
2. **Job queued** → BullMQ stores job in Redis
3. **Worker picks up job** → Checks auth status, spawns Claude container
4. **Claude investigates** → Uses CLI tools to query Sentry/CircleCI/GitHub APIs
5. **Claude decides** → Outputs `analysis.json` with fix decision
6. **If fixable** → Claude makes changes, commits
7. **Orchestrator finalizes** → Creates PR, updates issue status, notifies

---

## Prerequisites

### Software

| Tool | Purpose | Installation |
|------|---------|--------------|
| OrbStack | Docker runtime (lighter than Docker Desktop) | `brew install --cask orbstack` |
| Node.js 20+ | Router service runtime | `brew install node` |
| Claude Code CLI | AI coding agent | `npm install -g @anthropic-ai/claude-code` |
| cloudflared | Tunnel client | `brew install cloudflared` |

### Accounts & Tokens

| Service | Token/Secret | Required Scopes |
|---------|--------------|-----------------|
| Claude | OAuth login | Pro ($20/mo) or Max ($100/mo) subscription |
| GitHub | Personal Access Token (fine-grained) | `contents:write`, `pull_requests:write` on target repos |
| GitHub | Webhook Secret | Random string for signature verification |
| Sentry | Auth Token | `project:read`, `event:read`, `issue:write` |
| CircleCI | API Token | Read access to projects |
| Discord/Slack | Webhook URL | For notifications (optional) |

### Initial Claude Authentication

```bash
# Run interactively to complete OAuth
claude

# Credentials stored at ~/.claude/
# This directory will be mounted into containers
```

---

## Directory Structure

```
claude-agent/
├── docker-compose.yml
├── .env
├── .gitignore
│
├── router/
│   ├── Dockerfile
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts                 # Express app entry point
│       │
│       ├── config/
│       │   └── projects.ts          # Project registry
│       │
│       ├── webhooks/
│       │   ├── index.ts             # Route mounting
│       │   ├── sentry.ts            # Sentry webhook handler
│       │   ├── github.ts            # GitHub webhook handler
│       │   ├── circleci.ts          # CircleCI webhook handler
│       │   └── status.ts            # Health/dashboard endpoints
│       │
│       ├── queue/
│       │   ├── index.ts             # Queue initialization
│       │   └── worker.ts            # Job processor
│       │
│       ├── handlers/
│       │   ├── run-claude.ts        # Container spawning logic
│       │   ├── sentry-fix.ts        # Sentry fix orchestration
│       │   ├── github-issue.ts      # GitHub issue orchestration
│       │   └── circleci-fix.ts      # CircleCI fix orchestration
│       │
│       ├── services/
│       │   ├── sentry.ts            # Sentry API client
│       │   ├── github.ts            # GitHub API client (Octokit)
│       │   └── circleci.ts          # CircleCI API client
│       │
│       ├── health/
│       │   ├── claude-auth.ts       # Auth status checking
│       │   └── monitor.ts           # Periodic health monitoring
│       │
│       └── utils/
│           ├── exec.ts              # Promisified child_process
│           ├── crypto.ts            # Webhook signature verification
│           └── logger.ts            # Structured logging
│
├── claude-runner/
│   ├── Dockerfile
│   └── tools/
│       ├── sentry-get-issue         # Get Sentry issue details
│       ├── sentry-get-events        # Get Sentry events/stack traces
│       ├── sentry-get-breadcrumbs   # Get event breadcrumbs
│       ├── circleci-get-logs        # Get CI build logs
│       ├── circleci-get-tests       # Get test results
│       └── github-get-issue         # Get GitHub issue details
│
└── cloudflared/
    ├── config.yml                   # Tunnel configuration
    └── <tunnel-id>.json             # Tunnel credentials (gitignored)
```

---

## Core Components

### Environment Variables (.env)

```bash
# GitHub
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
GITHUB_WEBHOOK_SECRET=your-random-secret-string

# Sentry
SENTRY_AUTH_TOKEN=sntrys_xxxxxxxxxxxxxxxxxxxx
SENTRY_ORG=your-org-slug

# CircleCI
CIRCLECI_TOKEN=CCIPAT_xxxxxxxxxxxxxxxxxxxx

# Notifications (optional)
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/xxx/xxx

# System
USER=yourmacusername
NODE_ENV=production
```

### Project Registry (router/src/config/projects.ts)

```typescript
export interface ProjectConfig {
  id: string;
  repo: string;
  repoFullName: string;  // owner/repo format
  branch: string;
  triggers: {
    sentry?: {
      projectSlug: string;
      enabled: boolean;
    };
    github?: {
      issues: boolean;
      labels?: string[];  // Only trigger on these labels
    };
    circleci?: {
      projectSlug: string;
      enabled: boolean;
    };
  };
  constraints?: {
    maxAttemptsPerDay?: number;
    allowedPaths?: string[];  // Restrict Claude to these directories
    excludedPaths?: string[]; // Never touch these
  };
}

export const projects: ProjectConfig[] = [
  {
    id: 'signage-platform',
    repo: 'git@github.com:yourorg/signage-platform.git',
    repoFullName: 'yourorg/signage-platform',
    branch: 'main',
    triggers: {
      sentry: { projectSlug: 'signage-android', enabled: true },
      github: { issues: true, labels: ['bug', 'auto-fix-candidate'] },
      circleci: { projectSlug: 'gh/yourorg/signage-platform', enabled: true }
    },
    constraints: {
      maxAttemptsPerDay: 10,
      excludedPaths: ['src/config/', '.env']
    }
  },
  {
    id: 'marketing-site',
    repo: 'git@github.com:yourorg/marketing-site.git',
    repoFullName: 'yourorg/marketing-site',
    branch: 'main',
    triggers: {
      github: { issues: true }
    }
  }
];

// Lookup helpers
export function findProjectByRepo(repoFullName: string): ProjectConfig | undefined {
  return projects.find(p => p.repoFullName === repoFullName);
}

export function findProjectBySentrySlug(slug: string): ProjectConfig | undefined {
  return projects.find(p => p.triggers.sentry?.projectSlug === slug);
}

export function findProjectByCircleCISlug(slug: string): ProjectConfig | undefined {
  return projects.find(p => p.triggers.circleci?.projectSlug === slug);
}
```

---

## Docker Configuration

### docker-compose.yml

```yaml
version: "3.8"

services:
  # ─────────────────────────────────────────────
  # Infrastructure
  # ─────────────────────────────────────────────
  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data
    networks:
      - internal
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 3

  # ─────────────────────────────────────────────
  # Main Application
  # ─────────────────────────────────────────────
  router:
    build: ./router
    depends_on:
      redis:
        condition: service_healthy
    environment:
      - NODE_ENV=production
      - REDIS_URL=redis://redis:6379
      - GITHUB_TOKEN=${GITHUB_TOKEN}
      - GITHUB_WEBHOOK_SECRET=${GITHUB_WEBHOOK_SECRET}
      - SENTRY_AUTH_TOKEN=${SENTRY_AUTH_TOKEN}
      - SENTRY_ORG=${SENTRY_ORG}
      - CIRCLECI_TOKEN=${CIRCLECI_TOKEN}
      - DISCORD_WEBHOOK_URL=${DISCORD_WEBHOOK_URL}
      - HOST_USER=${USER}
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - workspaces:/workspaces
      - /Users/${USER}/.claude:/claude-creds:ro
    networks:
      - internal
    restart: unless-stopped

  # ─────────────────────────────────────────────
  # Claude Runner (image only, spawned dynamically)
  # ─────────────────────────────────────────────
  claude-runner:
    build: ./claude-runner
    image: claude-runner:latest
    profiles:
      - build-only

  # ─────────────────────────────────────────────
  # Tunnel
  # ─────────────────────────────────────────────
  tunnel:
    image: cloudflare/cloudflared:latest
    command: tunnel run
    volumes:
      - ./cloudflared:/etc/cloudflared:ro
    networks:
      - internal
    depends_on:
      - router
    restart: unless-stopped

  # ─────────────────────────────────────────────
  # Monitoring
  # ─────────────────────────────────────────────
  portainer:
    image: portainer/portainer-ce:latest
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - portainer_data:/data
    networks:
      - internal
    restart: unless-stopped

  dozzle:
    image: amir20/dozzle:latest
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    networks:
      - internal
    restart: unless-stopped

networks:
  internal:
    driver: bridge

volumes:
  redis_data:
  portainer_data:
  workspaces:
```

### Router Dockerfile (router/Dockerfile)

```dockerfile
FROM node:20-slim

RUN apt-get update && apt-get install -y \
    git \
    docker.io \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

EXPOSE 3000

CMD ["node", "dist/index.js"]
```

### Claude Runner Dockerfile (claude-runner/Dockerfile)

```dockerfile
FROM node:20-slim

# System dependencies
RUN apt-get update && apt-get install -y \
    git \
    curl \
    jq \
    && rm -rf /var/lib/apt/lists/*

# Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

# API tools
COPY tools/ /tools/
RUN chmod +x /tools/*

# Git config
RUN git config --global user.email "claude-bot@yourdomain.com" \
    && git config --global user.name "Claude Agent" \
    && git config --global init.defaultBranch main

# Non-root user
RUN useradd -m claude
USER claude

# Add tools to PATH
ENV PATH="/tools:${PATH}"

WORKDIR /workspace

ENTRYPOINT ["claude"]
```

---

## Webhook Handlers

### Main Router (router/src/index.ts)

```typescript
import express from 'express';
import { sentryRouter } from './webhooks/sentry';
import { githubRouter } from './webhooks/github';
import { circleciRouter } from './webhooks/circleci';
import { statusRouter } from './webhooks/status';
import { initializeQueue, startWorker } from './queue';
import { startAuthMonitor } from './health/monitor';

const app = express();
app.use(express.json());

// Webhook routes
app.use('/webhooks/sentry', sentryRouter);
app.use('/webhooks/github', githubRouter);
app.use('/webhooks/circleci', circleciRouter);

// Status & dashboard
app.use('/', statusRouter);

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Initialize
async function main() {
  await initializeQueue();
  startWorker();
  startAuthMonitor();
  
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`Router listening on port ${port}`);
  });
}

main().catch(console.error);
```

### Sentry Webhook (router/src/webhooks/sentry.ts)

```typescript
import { Router } from 'express';
import { findProjectBySentrySlug } from '../config/projects';
import { jobQueue } from '../queue';

export const sentryRouter = Router();

interface SentryWebhookPayload {
  action: string;
  data: {
    issue: {
      id: string;
      title: string;
      culprit: string;
      metadata: {
        filename?: string;
        function?: string;
        type?: string;
        value?: string;
      };
    };
    event?: {
      event_id: string;
    };
  };
  project: {
    slug: string;
    name: string;
  };
}

sentryRouter.post('/', async (req, res) => {
  const payload: SentryWebhookPayload = req.body;
  
  // Only handle new issues
  if (payload.action !== 'created') {
    return res.status(200).json({ ignored: true, reason: 'action not created' });
  }
  
  // Find matching project
  const project = findProjectBySentrySlug(payload.project.slug);
  if (!project || !project.triggers.sentry?.enabled) {
    return res.status(200).json({ ignored: true, reason: 'project not configured' });
  }
  
  // Queue the job
  await jobQueue.add('sentry-fix', {
    type: 'sentry-fix',
    projectId: project.id,
    payload: {
      issueId: payload.data.issue.id,
      title: payload.data.issue.title,
      culprit: payload.data.issue.culprit,
      metadata: payload.data.issue.metadata,
      eventId: payload.data.event?.event_id
    }
  }, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 }
  });
  
  res.status(202).json({ queued: true, issueId: payload.data.issue.id });
});
```

### GitHub Webhook (router/src/webhooks/github.ts)

```typescript
import { Router } from 'express';
import crypto from 'crypto';
import { findProjectByRepo } from '../config/projects';
import { jobQueue } from '../queue';

export const githubRouter = Router();

// Signature verification middleware
function verifySignature(req: any, res: any, next: any) {
  const signature = req.headers['x-hub-signature-256'];
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  
  if (!signature || !secret) {
    return res.status(401).json({ error: 'Missing signature' });
  }
  
  const body = JSON.stringify(req.body);
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
  
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  
  next();
}

githubRouter.post('/', verifySignature, async (req, res) => {
  const event = req.headers['x-github-event'];
  const payload = req.body;
  
  // Handle issues
  if (event === 'issues' && payload.action === 'opened') {
    const project = findProjectByRepo(payload.repository.full_name);
    
    if (!project?.triggers.github?.issues) {
      return res.status(200).json({ ignored: true, reason: 'not configured' });
    }
    
    // Check label filters
    const issueLabels = payload.issue.labels?.map((l: any) => l.name) || [];
    const requiredLabels = project.triggers.github.labels;
    
    if (requiredLabels?.length) {
      const hasMatch = requiredLabels.some(l => issueLabels.includes(l));
      if (!hasMatch) {
        return res.status(200).json({ ignored: true, reason: 'label filter' });
      }
    }
    
    await jobQueue.add('github-issue', {
      type: 'github-issue',
      projectId: project.id,
      payload: {
        issueNumber: payload.issue.number,
        title: payload.issue.title,
        body: payload.issue.body,
        labels: issueLabels,
        user: payload.issue.user.login
      }
    });
    
    return res.status(202).json({ queued: true });
  }
  
  res.status(200).json({ ignored: true, reason: 'unhandled event' });
});
```

### CircleCI Webhook (router/src/webhooks/circleci.ts)

```typescript
import { Router } from 'express';
import { findProjectByCircleCISlug } from '../config/projects';
import { jobQueue } from '../queue';

export const circleciRouter = Router();

circleciRouter.post('/', async (req, res) => {
  const payload = req.body;
  
  // Only handle job failures
  if (payload.type !== 'job-completed' || payload.job.status !== 'failed') {
    return res.status(200).json({ ignored: true });
  }
  
  const project = findProjectByCircleCISlug(payload.project.slug);
  if (!project?.triggers.circleci?.enabled) {
    return res.status(200).json({ ignored: true, reason: 'not configured' });
  }
  
  // Only handle test jobs (configurable)
  const testJobPatterns = ['test', 'spec', 'check'];
  const isTestJob = testJobPatterns.some(p => 
    payload.job.name.toLowerCase().includes(p)
  );
  
  if (!isTestJob) {
    return res.status(200).json({ ignored: true, reason: 'not a test job' });
  }
  
  await jobQueue.add('circleci-fix', {
    type: 'circleci-fix',
    projectId: project.id,
    payload: {
      jobId: payload.job.id,
      jobName: payload.job.name,
      jobUrl: payload.job.url,
      branch: payload.pipeline.vcs.branch,
      commitSha: payload.pipeline.vcs.revision,
      pipelineId: payload.pipeline.id
    }
  });
  
  res.status(202).json({ queued: true });
});
```

---

## Job Queue System

### Queue Setup (router/src/queue/index.ts)

```typescript
import { Queue, Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { handleSentryFix } from '../handlers/sentry-fix';
import { handleGitHubIssue } from '../handlers/github-issue';
import { handleCircleCIFix } from '../handlers/circleci-fix';
import { getAuthStatus } from '../health/claude-auth';
import { projects } from '../config/projects';

const connection = new Redis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: null
});

export const jobQueue = new Queue('claude-tasks', { connection });

export async function initializeQueue() {
  // Clean old jobs on startup
  await jobQueue.obliterate({ force: true });
  console.log('Queue initialized');
}

export function startWorker() {
  const worker = new Worker('claude-tasks', async (job: Job) => {
    // Check auth before processing
    const auth = getAuthStatus();
    if (!auth.valid) {
      throw new Error('AUTH_EXPIRED');
    }
    
    // Get project config
    const project = projects.find(p => p.id === job.data.projectId);
    if (!project) {
      throw new Error(`Project not found: ${job.data.projectId}`);
    }
    
    // Route to handler
    switch (job.data.type) {
      case 'sentry-fix':
        return await handleSentryFix(project, job.data.payload);
      case 'github-issue':
        return await handleGitHubIssue(project, job.data.payload);
      case 'circleci-fix':
        return await handleCircleCIFix(project, job.data.payload);
      default:
        throw new Error(`Unknown job type: ${job.data.type}`);
    }
  }, {
    connection,
    concurrency: 2,  // Max 2 Claude containers at once
    limiter: {
      max: 10,
      duration: 60000  // Max 10 jobs per minute
    }
  });
  
  worker.on('completed', (job) => {
    console.log(`Job ${job.id} completed`);
  });
  
  worker.on('failed', (job, err) => {
    console.error(`Job ${job?.id} failed:`, err.message);
  });
  
  console.log('Worker started');
}
```

---

## Claude Runner

### Container Spawning (router/src/handlers/run-claude.ts)

```typescript
import { exec } from 'child_process';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import { mkdir, rm, readFile } from 'fs/promises';
import path from 'path';

const execAsync = promisify(exec);

export interface RunClaudeOptions {
  repoUrl: string;
  branch: string;
  prompt: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

export interface RunClaudeResult {
  success: boolean;
  jobId: string;
  output: string;
  hasCommit: boolean;
  analysis?: AnalysisResult;
}

export interface AnalysisResult {
  canAutoFix: boolean;
  confidence: 'high' | 'medium' | 'low';
  summary: string;
  rootCause: string;
  proposedFix?: string;
  reason?: string;
  filesInvolved: string[];
  complexity: 'trivial' | 'simple' | 'moderate' | 'complex';
}

export async function runClaudeInContainer(options: RunClaudeOptions): Promise<RunClaudeResult> {
  const jobId = randomUUID();
  const workspacePath = `/workspaces/${jobId}`;
  const hostUser = process.env.HOST_USER || 'claude';
  const timeout = options.timeoutMs || 600000; // 10 minutes default
  
  try {
    // Clone repo
    await execAsync(`git clone --depth 1 -b ${options.branch} ${options.repoUrl} ${workspacePath}`);
    
    // Create branch for fixes
    const fixBranch = `fix/auto-${jobId.slice(0, 8)}`;
    await execAsync(`git checkout -b ${fixBranch}`, { cwd: workspacePath });
    
    // Build environment variables string
    const envFlags = Object.entries(options.env || {})
      .map(([k, v]) => `-e ${k}="${v}"`)
      .join(' ');
    
    // Escape prompt for shell
    const escapedPrompt = options.prompt.replace(/"/g, '\\"').replace(/`/g, '\\`');
    
    // Run Claude
    const { stdout, stderr } = await execAsync(`
      docker run --rm \
        --name claude-${jobId.slice(0, 8)} \
        --network claude-agent_internal \
        -v ${workspacePath}:/workspace \
        -v /Users/${hostUser}/.claude:/home/claude/.claude:ro \
        -e SENTRY_AUTH_TOKEN="${process.env.SENTRY_AUTH_TOKEN}" \
        -e CIRCLECI_TOKEN="${process.env.CIRCLECI_TOKEN}" \
        -e GITHUB_TOKEN="${process.env.GITHUB_TOKEN}" \
        ${envFlags} \
        --cpus="2" \
        --memory="4g" \
        --pids-limit 100 \
        claude-runner:latest \
        --print \
        --dangerously-skip-permissions \
        --max-turns 30 \
        -p "${escapedPrompt}"
    `, { timeout, maxBuffer: 10 * 1024 * 1024 });
    
    // Check for commits
    const { stdout: gitLog } = await execAsync(
      'git log --oneline -1 2>/dev/null || echo "no commits"',
      { cwd: workspacePath }
    );
    const hasCommit = !gitLog.includes('no commits') && gitLog.trim().length > 0;
    
    // Try to read analysis.json
    let analysis: AnalysisResult | undefined;
    try {
      const analysisPath = path.join(workspacePath, '.claude', 'analysis.json');
      const content = await readFile(analysisPath, 'utf-8');
      analysis = JSON.parse(content);
    } catch {
      // No analysis file, that's okay
    }
    
    // If there's a commit, push the branch
    if (hasCommit) {
      await execAsync(`git push origin ${fixBranch}`, { cwd: workspacePath });
    }
    
    return {
      success: true,
      jobId,
      output: stdout,
      hasCommit,
      analysis
    };
    
  } catch (error: any) {
    return {
      success: false,
      jobId,
      output: error.message,
      hasCommit: false
    };
  } finally {
    // Cleanup workspace
    await rm(workspacePath, { recursive: true, force: true }).catch(() => {});
  }
}
```

---

## API Tools for Claude

These CLI tools are bundled into the Claude runner container, allowing Claude to fetch context from external services via bash.

### sentry-get-issue (claude-runner/tools/sentry-get-issue)

```bash
#!/bin/bash
set -e

ISSUE_ID="$1"
if [ -z "$ISSUE_ID" ]; then
  echo "Usage: sentry-get-issue <issue-id>" >&2
  exit 1
fi

curl -s "https://sentry.io/api/0/issues/${ISSUE_ID}/" \
  -H "Authorization: Bearer ${SENTRY_AUTH_TOKEN}" \
  | jq '{
    id: .id,
    title: .title,
    culprit: .culprit,
    type: .type,
    platform: .platform,
    firstSeen: .firstSeen,
    lastSeen: .lastSeen,
    count: .count,
    userCount: .userCount,
    metadata: .metadata,
    tags: [.tags[] | {key: .key, value: .value}]
  }'
```

### sentry-get-events (claude-runner/tools/sentry-get-events)

```bash
#!/bin/bash
set -e

ISSUE_ID="$1"
LIMIT="${2:-5}"

if [ -z "$ISSUE_ID" ]; then
  echo "Usage: sentry-get-events <issue-id> [limit]" >&2
  exit 1
fi

curl -s "https://sentry.io/api/0/issues/${ISSUE_ID}/events/?limit=${LIMIT}" \
  -H "Authorization: Bearer ${SENTRY_AUTH_TOKEN}" \
  | jq '.[] | {
    eventId: .eventID,
    timestamp: .dateCreated,
    message: .message,
    tags: .tags,
    context: .context,
    user: .user,
    stacktrace: (
      .entries 
      | map(select(.type == "exception")) 
      | .[0].data.values[0].stacktrace.frames[-5:]
    ),
    breadcrumbs: (
      .entries 
      | map(select(.type == "breadcrumbs")) 
      | .[0].data.values[-10:]
    )
  }'
```

### circleci-get-logs (claude-runner/tools/circleci-get-logs)

```bash
#!/bin/bash
set -e

JOB_ID="$1"
if [ -z "$JOB_ID" ]; then
  echo "Usage: circleci-get-logs <job-id>" >&2
  exit 1
fi

# Get job details first
JOB=$(curl -s "https://circleci.com/api/v2/project/job/${JOB_ID}" \
  -H "Circle-Token: ${CIRCLECI_TOKEN}")

# Get all steps
STEPS=$(echo "$JOB" | jq -r '.steps[] | @base64')

for step in $STEPS; do
  _jq() {
    echo ${step} | base64 --decode | jq -r ${1}
  }
  
  NAME=$(_jq '.name')
  STATUS=$(_jq '.status')
  
  echo "=== Step: $NAME (${STATUS}) ==="
  
  # Get step output
  ACTIONS=$(_jq '.actions[] | @base64')
  for action in $ACTIONS; do
    OUTPUT_URL=$(echo ${action} | base64 --decode | jq -r '.output_url // empty')
    if [ -n "$OUTPUT_URL" ]; then
      curl -s "$OUTPUT_URL" -H "Circle-Token: ${CIRCLECI_TOKEN}" | head -500
    fi
  done
  
  echo ""
done
```

### circleci-get-tests (claude-runner/tools/circleci-get-tests)

```bash
#!/bin/bash
set -e

JOB_ID="$1"
if [ -z "$JOB_ID" ]; then
  echo "Usage: circleci-get-tests <job-id>" >&2
  exit 1
fi

curl -s "https://circleci.com/api/v2/project/job/${JOB_ID}/tests" \
  -H "Circle-Token: ${CIRCLECI_TOKEN}" \
  | jq '.items | map(select(.result != "success")) | .[:20] | {
    failedTests: map({
      name: .name,
      classname: .classname,
      file: .file,
      result: .result,
      message: .message
    })
  }'
```

### github-get-issue (claude-runner/tools/github-get-issue)

```bash
#!/bin/bash
set -e

REPO="$1"
ISSUE_NUM="$2"

if [ -z "$REPO" ] || [ -z "$ISSUE_NUM" ]; then
  echo "Usage: github-get-issue <owner/repo> <issue-number>" >&2
  exit 1
fi

# Get issue
ISSUE=$(curl -s "https://api.github.com/repos/${REPO}/issues/${ISSUE_NUM}" \
  -H "Authorization: Bearer ${GITHUB_TOKEN}" \
  -H "Accept: application/vnd.github.v3+json")

# Get comments
COMMENTS=$(curl -s "https://api.github.com/repos/${REPO}/issues/${ISSUE_NUM}/comments" \
  -H "Authorization: Bearer ${GITHUB_TOKEN}" \
  -H "Accept: application/vnd.github.v3+json")

echo "$ISSUE" | jq --argjson comments "$COMMENTS" '{
  number: .number,
  title: .title,
  body: .body,
  state: .state,
  user: .user.login,
  labels: [.labels[].name],
  created_at: .created_at,
  comments: ($comments | map({user: .user.login, body: .body, created_at: .created_at}))
}'
```

---

## Analysis & Fix Flow

### Analysis Prompt Builder (router/src/handlers/prompts.ts)

```typescript
export function buildAnalysisPrompt(
  source: 'sentry' | 'github' | 'circleci',
  sourceId: string,
  additionalContext?: string
): string {
  const toolsSection = {
    sentry: `
## Available Tools

Run these commands to investigate:

- \`sentry-get-issue ${sourceId}\` - Get issue overview, metadata, tags
- \`sentry-get-events ${sourceId}\` - Get recent events with stack traces and breadcrumbs
- \`sentry-get-events ${sourceId} 10\` - Get more events if needed
`,
    github: `
## Available Tools

Run these commands to investigate:

- \`github-get-issue REPO ${sourceId}\` - Get issue details and comments
`,
    circleci: `
## Available Tools

Run these commands to investigate:

- \`circleci-get-tests ${sourceId}\` - Get failed test details
- \`circleci-get-logs ${sourceId}\` - Get build/test logs
`
  };

  return `
You are an automated bug fixer. Your job is to analyze a bug and either fix it or explain why it cannot be auto-fixed.

${toolsSection[source]}

${additionalContext ? `## Additional Context\n\n${additionalContext}\n` : ''}

## Investigation Process

1. **Gather Information**: Use the tools above to fully understand the bug
2. **Explore Codebase**: Search for relevant files, understand the context
3. **Identify Root Cause**: Determine what's actually causing the issue
4. **Assess Complexity**: Can this be fixed with high confidence?

## Decision Criteria

**DO auto-fix if:**
- Clear, isolated bug with obvious fix
- Type errors, null checks, off-by-one errors
- Missing error handling
- Simple logic errors
- Test failures with clear assertions

**DON'T auto-fix if:**
- Requires architectural changes
- Involves security-sensitive code
- Needs domain expertise to understand
- Could have unintended side effects
- Requires coordination with other systems
- You're not confident in the fix

## Output

After investigation, create a file \`.claude/analysis.json\` with this structure:

\`\`\`json
{
  "canAutoFix": true | false,
  "confidence": "high" | "medium" | "low",
  "summary": "One-line description of the bug",
  "rootCause": "What is causing this bug",
  "proposedFix": "How you will fix it (if canAutoFix)",
  "reason": "Why it cannot be auto-fixed (if !canAutoFix)",
  "filesInvolved": ["src/path/to/file.ts"],
  "complexity": "trivial" | "simple" | "moderate" | "complex"
}
\`\`\`

## If canAutoFix is true AND confidence is "high":

1. Implement the fix with minimal changes
2. Run existing tests if available
3. Add a test for the bug if straightforward
4. Commit with message: "fix: <summary>"

## If canAutoFix is false OR confidence is not "high":

Stop after creating analysis.json. Do not make any code changes.

---

Begin by investigating the issue.
`.trim();
}
```

### Sentry Fix Handler (router/src/handlers/sentry-fix.ts)

```typescript
import { ProjectConfig } from '../config/projects';
import { runClaudeInContainer } from './run-claude';
import { buildAnalysisPrompt } from './prompts';
import { createPullRequest } from '../services/github';
import { updateSentryIssue, addSentryComment } from '../services/sentry';
import { sendNotification } from '../services/notifications';

interface SentryPayload {
  issueId: string;
  title: string;
  culprit: string;
  metadata: any;
  eventId?: string;
}

export async function handleSentryFix(project: ProjectConfig, payload: SentryPayload) {
  const { issueId, title } = payload;
  
  console.log(`[sentry-fix] Starting fix for issue ${issueId}: ${title}`);
  
  // Build prompt
  const prompt = buildAnalysisPrompt(
    'sentry',
    issueId,
    `**Error Title:** ${title}\n**Culprit:** ${payload.culprit}`
  );
  
  // Run Claude
  const result = await runClaudeInContainer({
    repoUrl: project.repo,
    branch: project.branch,
    prompt
  });
  
  // Handle failure
  if (!result.success) {
    await addSentryComment(issueId, 
      `⚠️ Auto-fix attempt failed:\n\`\`\`\n${result.output.slice(0, 500)}\n\`\`\``
    );
    await sendNotification(`❌ Sentry fix failed for ${project.id}: ${title}`);
    return;
  }
  
  // Check Claude's decision
  const analysis = result.analysis;
  
  if (!analysis) {
    await addSentryComment(issueId, '⚠️ Auto-fix completed but no analysis output found');
    return;
  }
  
  if (!analysis.canAutoFix || analysis.confidence !== 'high') {
    // Claude decided not to fix - post analysis as comment
    await addSentryComment(issueId, formatAnalysisComment(analysis));
    await sendNotification(
      `🔍 Sentry issue analyzed (not auto-fixed): ${title}\n` +
      `Reason: ${analysis.reason || 'Low confidence'}`
    );
    return;
  }
  
  // Claude fixed it - create PR
  if (!result.hasCommit) {
    await addSentryComment(issueId, '⚠️ Analysis indicated fix was possible but no commit was made');
    return;
  }
  
  const branchName = `fix/auto-${result.jobId.slice(0, 8)}`;
  
  const pr = await createPullRequest({
    owner: project.repoFullName.split('/')[0],
    repo: project.repoFullName.split('/')[1],
    head: branchName,
    base: project.branch,
    title: `fix: ${analysis.summary}`,
    body: formatPRBody(analysis, issueId, 'sentry')
  });
  
  // Update Sentry
  await updateSentryIssue(issueId, {
    status: 'resolved',
    statusDetails: { inNextRelease: true }
  });
  
  await addSentryComment(issueId, `✅ Automated fix submitted: ${pr.html_url}`);
  
  await sendNotification(
    `✅ Sentry auto-fix PR created: ${pr.html_url}\n` +
    `Issue: ${title}`
  );
}

function formatAnalysisComment(analysis: any): string {
  return `
## 🔍 Auto-Fix Analysis

**Summary:** ${analysis.summary}

**Root Cause:** ${analysis.rootCause}

**Can Auto-Fix:** ${analysis.canAutoFix ? 'Yes' : 'No'}
**Confidence:** ${analysis.confidence}
**Complexity:** ${analysis.complexity}

${analysis.reason ? `**Reason Not Fixed:** ${analysis.reason}` : ''}

**Files Involved:**
${analysis.filesInvolved.map((f: string) => `- \`${f}\``).join('\n')}

---
*This analysis was generated automatically by Claude Agent*
  `.trim();
}

function formatPRBody(analysis: any, sourceId: string, source: string): string {
  const sourceLinks = {
    sentry: `[Sentry Issue](https://sentry.io/issues/${sourceId})`,
    github: `Closes #${sourceId}`,
    circleci: `CircleCI Job: ${sourceId}`
  };
  
  return `
## Automated Fix

${sourceLinks[source]}

### Analysis

- **Root Cause:** ${analysis.rootCause}
- **Confidence:** ${analysis.confidence}
- **Complexity:** ${analysis.complexity}

### Changes

${analysis.proposedFix}

### Files Modified

${analysis.filesInvolved.map((f: string) => `- \`${f}\``).join('\n')}

---
*This PR was automatically generated by Claude Agent. Please review carefully before merging.*
  `.trim();
}
```

---

## Auth Health Monitoring

### Auth Checker (router/src/health/claude-auth.ts)

```typescript
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface AuthStatus {
  valid: boolean;
  lastChecked: Date;
  error?: string;
}

let currentStatus: AuthStatus = {
  valid: true,
  lastChecked: new Date()
};

export async function checkClaudeAuth(): Promise<AuthStatus> {
  const hostUser = process.env.HOST_USER || 'claude';
  
  try {
    await execAsync(`
      docker run --rm \
        -v /Users/${hostUser}/.claude:/home/claude/.claude:ro \
        claude-runner:latest \
        --print \
        --max-turns 1 \
        -p "respond with exactly: OK"
    `, { timeout: 60000 });
    
    currentStatus = {
      valid: true,
      lastChecked: new Date()
    };
  } catch (error: any) {
    currentStatus = {
      valid: false,
      lastChecked: new Date(),
      error: error.message?.slice(0, 200)
    };
  }
  
  return currentStatus;
}

export function getAuthStatus(): AuthStatus {
  return currentStatus;
}
```

### Monitor (router/src/health/monitor.ts)

```typescript
import { checkClaudeAuth, getAuthStatus } from './claude-auth';
import { jobQueue } from '../queue';
import { sendNotification } from '../services/notifications';

let wasValid = true;
let checkInterval: NodeJS.Timer;

export function startAuthMonitor() {
  // Check every 15 minutes
  checkInterval = setInterval(async () => {
    const status = await checkClaudeAuth();
    
    if (wasValid && !status.valid) {
      // Just became invalid
      await jobQueue.pause();
      await sendNotification(
        `⚠️ **Claude auth expired** - Queue paused\n` +
        `Error: ${status.error}\n\n` +
        `Run \`claude\` on the Mac Mini to re-authenticate, then hit /resume`
      );
      console.log('Auth expired, queue paused');
    } else if (!wasValid && status.valid) {
      // Just became valid
      await jobQueue.resume();
      await sendNotification(`✅ **Claude auth restored** - Queue resumed`);
      console.log('Auth restored, queue resumed');
    }
    
    wasValid = status.valid;
  }, 15 * 60 * 1000);
  
  // Initial check
  checkClaudeAuth().then(status => {
    wasValid = status.valid;
    if (!status.valid) {
      jobQueue.pause();
      sendNotification(
        `⚠️ **Claude auth invalid on startup** - Queue paused\n` +
        `Error: ${status.error}`
      );
    }
  });
  
  console.log('Auth monitor started');
}

export async function manualResume(): Promise<{ success: boolean; message: string }> {
  const status = await checkClaudeAuth();
  
  if (status.valid) {
    await jobQueue.resume();
    wasValid = true;
    return { success: true, message: 'Queue resumed' };
  }
  
  return { 
    success: false, 
    message: `Auth still invalid: ${status.error}` 
  };
}
```

### Status Endpoints (router/src/webhooks/status.ts)

```typescript
import { Router } from 'express';
import { getAuthStatus, checkClaudeAuth } from '../health/claude-auth';
import { manualResume } from '../health/monitor';
import { jobQueue } from '../queue';

export const statusRouter = Router();

// JSON status
statusRouter.get('/status', async (req, res) => {
  const auth = getAuthStatus();
  const [isPaused, waiting, active, completed, failed] = await Promise.all([
    jobQueue.isPaused(),
    jobQueue.getWaitingCount(),
    jobQueue.getActiveCount(),
    jobQueue.getCompletedCount(),
    jobQueue.getFailedCount()
  ]);
  
  res.json({
    auth: {
      valid: auth.valid,
      lastChecked: auth.lastChecked,
      error: auth.error
    },
    queue: {
      paused: isPaused,
      waiting,
      active,
      completed,
      failed
    }
  });
});

// Manual resume
statusRouter.post('/resume', async (req, res) => {
  const result = await manualResume();
  res.status(result.success ? 200 : 400).json(result);
});

// Dashboard
statusRouter.get('/dashboard', async (req, res) => {
  const auth = getAuthStatus();
  const isPaused = await jobQueue.isPaused();
  const waiting = await jobQueue.getWaitingCount();
  const active = await jobQueue.getActiveCount();
  
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
      max-width: 600px; 
      margin: 2rem auto; 
      padding: 1rem;
      background: #f5f5f5;
    }
    h1 { margin-bottom: 1.5rem; }
    .card {
      background: white;
      padding: 1rem 1.5rem;
      border-radius: 8px;
      margin-bottom: 1rem;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .status-ok { border-left: 4px solid #22c55e; }
    .status-error { border-left: 4px solid #ef4444; }
    .label { font-weight: 600; color: #666; }
    .value { font-size: 1.25rem; margin: 0.25rem 0; }
    .error { color: #ef4444; font-size: 0.875rem; }
    .meta { color: #999; font-size: 0.75rem; }
    button {
      background: #3b82f6;
      color: white;
      border: none;
      padding: 0.75rem 1.5rem;
      border-radius: 6px;
      cursor: pointer;
      font-size: 1rem;
    }
    button:hover { background: #2563eb; }
    .stats { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem; }
  </style>
</head>
<body>
  <h1>🤖 Claude Agent</h1>
  
  <div class="card ${auth.valid ? 'status-ok' : 'status-error'}">
    <div class="label">Authentication</div>
    <div class="value">${auth.valid ? '✅ Valid' : '❌ Expired'}</div>
    ${auth.error ? `<div class="error">${auth.error}</div>` : ''}
    <div class="meta">Last checked: ${auth.lastChecked.toLocaleString()}</div>
  </div>
  
  <div class="card ${isPaused ? 'status-error' : 'status-ok'}">
    <div class="label">Queue</div>
    <div class="value">${isPaused ? '⏸️ Paused' : '▶️ Running'}</div>
    <div class="stats">
      <div><span class="label">Waiting:</span> ${waiting}</div>
      <div><span class="label">Active:</span> ${active}</div>
    </div>
  </div>
  
  ${!auth.valid || isPaused ? `
    <form method="POST" action="/resume">
      <button type="submit">🔄 Check Auth & Resume</button>
    </form>
  ` : ''}
  
  <div class="meta" style="margin-top: 2rem; text-align: center;">
    Auto-refreshes every 30 seconds
  </div>
</body>
</html>
  `);
});
```

---

## Cloudflare Tunnel Setup

### Create Tunnel

```bash
# Install
brew install cloudflared

# Authenticate
cloudflared tunnel login

# Create tunnel
cloudflared tunnel create claude-agent
# Note the tunnel ID and credential file path

# Create DNS routes
cloudflared tunnel route dns claude-agent agent.yourdomain.com
cloudflared tunnel route dns claude-agent portainer.yourdomain.com
cloudflared tunnel route dns claude-agent logs.yourdomain.com
```

### Tunnel Config (cloudflared/config.yml)

```yaml
tunnel: <your-tunnel-id>
credentials-file: /etc/cloudflared/<your-tunnel-id>.json

ingress:
  # Main webhook endpoint
  - hostname: agent.yourdomain.com
    service: http://router:3000
  
  # Portainer (Docker management)
  - hostname: portainer.yourdomain.com
    service: https://portainer:9443
    originRequest:
      noTLSVerify: true
  
  # Dozzle (log viewer)
  - hostname: logs.yourdomain.com
    service: http://dozzle:8080
  
  # Catch-all
  - service: http_status:404
```

### Copy Credentials

```bash
# Copy credentials to project
cp ~/.cloudflared/<tunnel-id>.json ./cloudflared/
```

### Cloudflare Access (Optional but Recommended)

1. Go to Cloudflare Zero Trust dashboard
2. Create Access Application for `portainer.yourdomain.com`
3. Create Access Application for `logs.yourdomain.com`
4. Configure authentication (email OTP, SSO, etc.)

---

## Deployment Checklist

### Phase 1: Local Development

- [ ] Clone/create project structure
- [ ] Install dependencies: `cd router && npm install`
- [ ] Create `.env` with all tokens
- [ ] Build router: `npm run build`
- [ ] Test locally: `npm start`

### Phase 2: Docker Setup

- [ ] Install OrbStack: `brew install --cask orbstack`
- [ ] Build images: `docker compose --profile build-only build`
- [ ] Start stack: `docker compose up -d`
- [ ] Check logs: `docker compose logs -f router`
- [ ] Verify all services: `docker compose ps`

### Phase 3: Tunnel Setup

- [ ] Install cloudflared: `brew install cloudflared`
- [ ] Create tunnel: `cloudflared tunnel create claude-agent`
- [ ] Configure DNS routes
- [ ] Create `cloudflared/config.yml`
- [ ] Copy credentials JSON
- [ ] Test tunnel: `cloudflared tunnel run claude-agent`

### Phase 4: Webhook Configuration

**Sentry:**
- [ ] Settings → Integrations → Webhooks
- [ ] URL: `https://agent.yourdomain.com/webhooks/sentry`
- [ ] Events: Issue Created

**GitHub (per repo):**
- [ ] Repo → Settings → Webhooks → Add
- [ ] URL: `https://agent.yourdomain.com/webhooks/github`
- [ ] Secret: from `.env`
- [ ] Events: Issues

**CircleCI:**
- [ ] Project Settings → Webhooks
- [ ] URL: `https://agent.yourdomain.com/webhooks/circleci`
- [ ] Events: job-completed

### Phase 5: Mac Mini Deployment

- [ ] Transfer project to Mac Mini
- [ ] Create production `.env`
- [ ] Authenticate Claude Code: `claude`
- [ ] Build and start: `docker compose up -d`
- [ ] Verify tunnel in Cloudflare dashboard
- [ ] Test with real webhook

---

## Maintenance & Operations

### Auth Refresh Procedure

When you receive an auth expired notification:

1. SSH to Mac Mini or use Screen Sharing
2. Run `claude` in terminal
3. Complete OAuth flow in browser
4. Hit `POST /resume` or use dashboard button
5. Verify queue resumes

### Updating Claude Code

```bash
# On Mac Mini
npm update -g @anthropic-ai/claude-code

# Rebuild runner image
docker compose build claude-runner

# Restart (pulls new image)
docker compose up -d
```

### Viewing Logs

- **Dozzle**: `https://logs.yourdomain.com` - Real-time log streaming
- **Docker CLI**: `docker compose logs -f router`
- **Specific container**: `docker logs -f claude-agent-router-1`

### Queue Management

```bash
# Enter router container
docker exec -it claude-agent-router-1 sh

# Or use Redis CLI
docker exec -it claude-agent-redis-1 redis-cli

# Check queue
LRANGE bull:claude-tasks:wait 0 -1
```

### Troubleshooting

| Issue | Check |
|-------|-------|
| Webhooks not arriving | Cloudflare tunnel status, firewall |
| Jobs not processing | Auth status, queue pause state |
| Claude failing | Container logs, credential mount |
| PRs not created | GitHub token permissions |
| Sentry not updating | Sentry token permissions |

---

## Cost Summary

| Component | Cost |
|-----------|------|
| Claude Code | $20/mo (Pro) or $100/mo (Max) |
| Cloudflare Tunnel | Free |
| Cloudflare Access | Free (up to 50 users) |
| OrbStack | Free (personal) |
| Sentry | Free tier or existing plan |
| Everything else | Self-hosted, free |

---

## Future Enhancements

- [ ] Linear webhook integration
- [ ] Slack/Discord rich notifications with buttons
- [ ] PR review automation (review bot comments)
- [ ] Auto-merge on green CI
- [ ] Rate limiting per project
- [ ] Web UI for configuration (instead of code)
- [ ] Grafana metrics dashboard
- [ ] Auto-retry failed fixes with different approach
