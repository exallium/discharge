# Generic Source Architecture

## Overview

The system uses a **plugin-based architecture** where bug sources are modular and the Claude runner is completely generic. Adding a new source requires implementing a standard interface, not writing custom handlers.

---

## Core Abstractions

### Source Interface

All bug sources implement this interface:

```typescript
interface SourcePlugin {
  // Identification
  id: string;
  type: string; // 'sentry', 'github-issues', 'circleci', etc.

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

### Source Event

Normalized event structure:

```typescript
interface SourceEvent {
  // Core identification
  sourceType: string;           // 'sentry', 'github-issues', etc.
  sourceId: string;              // Issue ID, event ID, job ID, etc.
  projectId: string;             // Which project config to use

  // Display info
  title: string;
  description: string;

  // Structured metadata
  metadata: {
    severity?: 'low' | 'medium' | 'high' | 'critical';
    tags?: string[];
    environment?: string;
    [key: string]: any;
  };

  // Links
  links?: {
    web?: string;
    api?: string;
  };

  // Raw payload (for tool use)
  raw: any;
}
```

### Tool Definition

Tools are bash scripts dynamically generated per source:

```typescript
interface Tool {
  name: string;                  // CLI command name
  script: string;                // Bash script content
  description: string;           // Usage instructions
  env?: Record<string, string>;  // Additional env vars needed
}
```

---

## Directory Structure

```
claude-agent/
├── router/
│   └── src/
│       ├── index.ts                    # Express app
│       ├── config/
│       │   └── projects.ts             # Project registry
│       │
│       ├── sources/
│       │   ├── index.ts                # Source registry
│       │   ├── base.ts                 # Base interfaces
│       │   ├── sentry.ts               # Sentry plugin
│       │   ├── github-issues.ts        # GitHub Issues plugin
│       │   └── circleci.ts             # CircleCI plugin
│       │
│       ├── webhooks/
│       │   ├── index.ts                # Generic webhook router
│       │   └── status.ts               # Health/dashboard
│       │
│       ├── queue/
│       │   ├── index.ts                # Queue initialization
│       │   └── worker.ts               # Generic job processor
│       │
│       ├── runner/
│       │   ├── orchestrator.ts         # Generic fix orchestration
│       │   ├── claude.ts               # Container spawning
│       │   ├── tools.ts                # Tool generation
│       │   └── prompts.ts              # Generic prompt builder
│       │
│       └── services/
│           ├── github.ts               # GitHub API client
│           └── notifications.ts        # Discord/Slack
│
└── agent-runners/
    └── claude-code/
        └── Dockerfile
```

---

## Implementation

### 1. Source Plugin Example (Sentry)

```typescript
// router/src/sources/sentry.ts
import { SourcePlugin, SourceEvent, Tool } from './base';
import { findProjectBySentrySlug } from '../config/projects';

export class SentrySource implements SourcePlugin {
  id = 'sentry';
  type = 'sentry';

  async validateWebhook(req: Request): Promise<boolean> {
    // Sentry doesn't sign webhooks, could check IP ranges
    return true;
  }

  async parseWebhook(payload: any): Promise<SourceEvent | null> {
    if (payload.action !== 'created') {
      return null; // Only handle new issues
    }

    const project = findProjectBySentrySlug(payload.project.slug);
    if (!project || !project.triggers.sentry?.enabled) {
      return null;
    }

    return {
      sourceType: 'sentry',
      sourceId: payload.data.issue.id,
      projectId: project.id,
      title: payload.data.issue.title,
      description: payload.data.issue.culprit,
      metadata: {
        severity: this.mapSentryLevel(payload.data.issue.level),
        environment: payload.data.issue.metadata.type,
        tags: payload.data.issue.tags?.map((t: any) => `${t.key}:${t.value}`)
      },
      links: {
        web: `https://sentry.io/issues/${payload.data.issue.id}/`,
        api: `https://sentry.io/api/0/issues/${payload.data.issue.id}/`
      },
      raw: payload
    };
  }

  getTools(event: SourceEvent): Tool[] {
    const issueId = event.sourceId;
    const org = process.env.SENTRY_ORG;

    return [
      {
        name: 'get-issue-details',
        description: `Get full issue details including metadata and tags`,
        script: `#!/bin/bash
set -e
curl -s "https://sentry.io/api/0/issues/${issueId}/" \\
  -H "Authorization: Bearer \${SENTRY_AUTH_TOKEN}" \\
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
`
      },
      {
        name: 'get-events',
        description: `Get recent error events with stack traces (usage: get-events [limit])`,
        script: `#!/bin/bash
set -e
LIMIT=\${1:-5}
curl -s "https://sentry.io/api/0/issues/${issueId}/events/?limit=\${LIMIT}" \\
  -H "Authorization: Bearer \${SENTRY_AUTH_TOKEN}" \\
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
`
      }
    ];
  }

  getPromptContext(event: SourceEvent): string {
    return `**Error Title:** ${event.title}
**Culprit:** ${event.description}
**Severity:** ${event.metadata.severity}
**Link:** ${event.links?.web}`;
  }

  async updateStatus(event: SourceEvent, status: FixStatus): Promise<void> {
    if (status.fixed) {
      await fetch(`https://sentry.io/api/0/issues/${event.sourceId}/`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${process.env.SENTRY_AUTH_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          status: 'resolved',
          statusDetails: { inNextRelease: true }
        })
      });
    }
  }

  async addComment(event: SourceEvent, comment: string): Promise<void> {
    await fetch(`https://sentry.io/api/0/issues/${event.sourceId}/comments/`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.SENTRY_AUTH_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ data: { text: comment } })
    });
  }

  getLink(event: SourceEvent): string {
    return `[Sentry Issue](${event.links?.web})`;
  }

  private mapSentryLevel(level: string): 'low' | 'medium' | 'high' | 'critical' {
    const map: Record<string, any> = {
      'error': 'high',
      'fatal': 'critical',
      'warning': 'medium',
      'info': 'low'
    };
    return map[level] || 'medium';
  }
}
```

### 2. Source Registry

```typescript
// router/src/sources/index.ts
import { SourcePlugin } from './base';
import { SentrySource } from './sentry';
import { GitHubIssuesSource } from './github-issues';
import { CircleCISource } from './circleci';

export const sources: SourcePlugin[] = [
  new SentrySource(),
  new GitHubIssuesSource(),
  new CircleCISource()
];

export function getSourceById(id: string): SourcePlugin | undefined {
  return sources.find(s => s.id === id);
}

export function getSourceByType(type: string): SourcePlugin | undefined {
  return sources.find(s => s.type === type);
}
```

### 3. Generic Webhook Handler

```typescript
// router/src/webhooks/index.ts
import { Router } from 'express';
import { sources } from '../sources';
import { jobQueue } from '../queue';

export const webhookRouter = Router();

// Generic webhook endpoint: /webhooks/:sourceId
webhookRouter.post('/:sourceId', async (req, res) => {
  const sourceId = req.params.sourceId;
  const source = sources.find(s => s.id === sourceId);

  if (!source) {
    return res.status(404).json({ error: 'Unknown source' });
  }

  try {
    // Validate webhook
    const isValid = await source.validateWebhook(req);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }

    // Parse webhook
    const event = await source.parseWebhook(req.body);
    if (!event) {
      return res.status(200).json({ ignored: true, reason: 'filtered' });
    }

    // Optional pre-filtering
    if (source.shouldProcess) {
      const shouldProcess = await source.shouldProcess(event);
      if (!shouldProcess) {
        return res.status(200).json({ ignored: true, reason: 'shouldProcess=false' });
      }
    }

    // Queue the job
    await jobQueue.add('fix-job', {
      event,
      sourceType: source.type
    }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 }
    });

    res.status(202).json({
      queued: true,
      sourceType: event.sourceType,
      sourceId: event.sourceId
    });

  } catch (error: any) {
    console.error(`Webhook error for ${sourceId}:`, error);
    res.status(500).json({ error: error.message });
  }
});
```

### 4. Generic Job Worker

```typescript
// router/src/queue/worker.ts
import { Worker, Job } from 'bullmq';
import { getSourceByType } from '../sources';
import { orchestrateFix } from '../runner/orchestrator';

export function startWorker(connection: any) {
  const worker = new Worker('fix-job', async (job: Job) => {
    const { event, sourceType } = job.data;

    // Get the source plugin
    const source = getSourceByType(sourceType);
    if (!source) {
      throw new Error(`Unknown source type: ${sourceType}`);
    }

    // Orchestrate the fix
    return await orchestrateFix(source, event);

  }, {
    connection,
    concurrency: 2,
    limiter: { max: 10, duration: 60000 }
  });

  worker.on('completed', (job) => {
    console.log(`Job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    console.error(`Job ${job?.id} failed:`, err.message);
  });

  return worker;
}
```

### 5. Generic Orchestrator

```typescript
// router/src/runner/orchestrator.ts
import { SourcePlugin, SourceEvent, FixStatus } from '../sources/base';
import { runClaudeInContainer } from './claude';
import { buildGenericPrompt } from './prompts';
import { generateToolScripts } from './tools';
import { createPullRequest } from '../services/github';
import { projects } from '../config/projects';

export async function orchestrateFix(
  source: SourcePlugin,
  event: SourceEvent
): Promise<FixStatus> {

  const project = projects.find(p => p.id === event.projectId);
  if (!project) {
    throw new Error(`Project not found: ${event.projectId}`);
  }

  console.log(`[${event.sourceType}] Fixing ${event.sourceId}: ${event.title}`);

  // Generate tools for this source
  const tools = source.getTools(event);
  const toolScripts = generateToolScripts(tools);

  // Build prompt
  const prompt = buildGenericPrompt(source, event, tools);

  // Run Claude
  const result = await runClaudeInContainer({
    repoUrl: project.repo,
    branch: project.branch,
    prompt,
    tools: toolScripts
  });

  // Handle failure
  if (!result.success) {
    await source.addComment(event,
      `⚠️ Auto-fix attempt failed:\n\`\`\`\n${result.output.slice(0, 500)}\n\`\`\``
    );
    return { fixed: false, reason: 'claude_failed' };
  }

  const analysis = result.analysis;

  // No analysis output
  if (!analysis) {
    await source.addComment(event, '⚠️ Fix completed but no analysis found');
    return { fixed: false, reason: 'no_analysis' };
  }

  // Low confidence - post analysis only
  if (!analysis.canAutoFix || analysis.confidence !== 'high') {
    await source.addComment(event, formatAnalysisComment(analysis));
    return {
      fixed: false,
      reason: 'low_confidence',
      analysis
    };
  }

  // No commit made
  if (!result.hasCommit) {
    await source.addComment(event, '⚠️ Analysis indicated fix but no commit made');
    return { fixed: false, reason: 'no_commit' };
  }

  // Create PR
  const branchName = `fix/auto-${result.jobId.slice(0, 8)}`;
  const [owner, repo] = project.repoFullName.split('/');

  const pr = await createPullRequest({
    owner,
    repo,
    head: branchName,
    base: project.branch,
    title: `fix: ${analysis.summary}`,
    body: formatPRBody(analysis, source, event)
  });

  // Update source
  await source.updateStatus(event, { fixed: true, analysis });
  await source.addComment(event, `✅ Automated fix submitted: ${pr.html_url}`);

  return {
    fixed: true,
    prUrl: pr.html_url,
    analysis
  };
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
*Generated by Claude Agent*
  `.trim();
}

function formatPRBody(analysis: any, source: SourcePlugin, event: SourceEvent): string {
  return `
## Automated Fix

${source.getLink(event)}

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

interface FixStatus {
  fixed: boolean;
  reason?: string;
  analysis?: any;
  prUrl?: string;
}
```

### 6. Generic Prompt Builder

```typescript
// router/src/runner/prompts.ts
import { SourcePlugin, SourceEvent, Tool } from '../sources/base';

export function buildGenericPrompt(
  source: SourcePlugin,
  event: SourceEvent,
  tools: Tool[]
): string {

  const toolsSection = tools.map(t =>
    `- \`${t.name}\` - ${t.description}`
  ).join('\n');

  const context = source.getPromptContext(event);

  return `
You are an automated bug fixer investigating a ${event.sourceType} issue.

## Issue Details

${context}

## Available Tools

Run these commands to investigate:

${toolsSection}

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
- Needs domain expertise
- Could have unintended side effects
- Requires coordination with other systems
- You're not confident in the fix

## Output

Create a file \`.claude/analysis.json\`:

\`\`\`json
{
  "canAutoFix": true | false,
  "confidence": "high" | "medium" | "low",
  "summary": "One-line description",
  "rootCause": "What is causing this",
  "proposedFix": "How you will fix it (if canAutoFix)",
  "reason": "Why not fixable (if !canAutoFix)",
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

Begin investigation.
`.trim();
}
```

### 7. Tool Script Generation

```typescript
// router/src/runner/tools.ts
import { Tool } from '../sources/base';
import { writeFile, mkdir, chmod } from 'fs/promises';
import path from 'path';

export function generateToolScripts(tools: Tool[]): Map<string, string> {
  const scripts = new Map<string, string>();

  for (const tool of tools) {
    scripts.set(tool.name, tool.script);
  }

  return scripts;
}

export async function writeToolsToWorkspace(
  workspacePath: string,
  tools: Map<string, string>
): Promise<void> {
  const toolsDir = path.join(workspacePath, '.claude-tools');
  await mkdir(toolsDir, { recursive: true });

  for (const [name, script] of tools.entries()) {
    const toolPath = path.join(toolsDir, name);
    await writeFile(toolPath, script, { mode: 0o755 });
    await chmod(toolPath, 0o755);
  }
}
```

### 8. Updated Claude Runner

```typescript
// router/src/runner/claude.ts
import { exec } from 'child_process';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import { rm, readFile } from 'fs/promises';
import { writeToolsToWorkspace } from './tools';

const execAsync = promisify(exec);

export interface RunClaudeOptions {
  repoUrl: string;
  branch: string;
  prompt: string;
  tools: Map<string, string>;  // tool name -> script content
  timeoutMs?: number;
}

export async function runClaudeInContainer(options: RunClaudeOptions) {
  const jobId = randomUUID();
  const workspacePath = `/workspaces/${jobId}`;
  const timeout = options.timeoutMs || 600000;

  try {
    // Clone repo
    await execAsync(`git clone --depth 1 -b ${options.branch} ${options.repoUrl} ${workspacePath}`);

    // Create fix branch
    const fixBranch = `fix/auto-${jobId.slice(0, 8)}`;
    await execAsync(`git checkout -b ${fixBranch}`, { cwd: workspacePath });

    // Write tools to workspace
    await writeToolsToWorkspace(workspacePath, options.tools);

    // Escape prompt
    const escapedPrompt = options.prompt.replace(/"/g, '\\"').replace(/`/g, '\\`');

    // Run Claude
    const { stdout } = await execAsync(`
      docker run --rm \
        --name claude-${jobId.slice(0, 8)} \
        --network claude-agent_internal \
        -v ${workspacePath}:/workspace \
        -v /Users/${process.env.HOST_USER}/.claude:/home/claude/.claude:ro \
        -e SENTRY_AUTH_TOKEN="${process.env.SENTRY_AUTH_TOKEN}" \
        -e CIRCLECI_TOKEN="${process.env.CIRCLECI_TOKEN}" \
        -e GITHUB_TOKEN="${process.env.GITHUB_TOKEN}" \
        -e PATH="/workspace/.claude-tools:\${PATH}" \
        --cpus="2" \
        --memory="4g" \
        agent-runner-claude:latest \
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
    const hasCommit = !gitLog.includes('no commits');

    // Read analysis
    let analysis;
    try {
      const analysisPath = path.join(workspacePath, '.claude', 'analysis.json');
      analysis = JSON.parse(await readFile(analysisPath, 'utf-8'));
    } catch {}

    // Push if commit exists
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
    await rm(workspacePath, { recursive: true, force: true }).catch(() => {});
  }
}
```

---

## Adding a New Source

To add a new source (e.g., Linear, Jira, Datadog):

1. **Create plugin file**: `router/src/sources/linear.ts`
2. **Implement `SourcePlugin` interface**
3. **Register in `sources/index.ts`**
4. **Configure webhooks** to point to `/webhooks/linear`

Example for Linear:

```typescript
// router/src/sources/linear.ts
export class LinearSource implements SourcePlugin {
  id = 'linear';
  type = 'linear';

  async validateWebhook(req: Request): Promise<boolean> {
    // Verify Linear webhook signature
    return true;
  }

  async parseWebhook(payload: any): Promise<SourceEvent | null> {
    if (payload.action !== 'create' || payload.type !== 'Issue') {
      return null;
    }

    return {
      sourceType: 'linear',
      sourceId: payload.data.id,
      projectId: 'my-project', // map from Linear team/project
      title: payload.data.title,
      description: payload.data.description,
      metadata: {
        priority: payload.data.priority,
        labels: payload.data.labels
      },
      raw: payload
    };
  }

  getTools(event: SourceEvent): Tool[] {
    return [
      {
        name: 'get-issue',
        description: 'Get Linear issue details',
        script: `#!/bin/bash
curl -X POST https://api.linear.app/graphql \\
  -H "Authorization: Bearer \${LINEAR_TOKEN}" \\
  -d '{"query":"{ issue(id:\\"${event.sourceId}\\") { title description comments { nodes { body } } } }"}'
`
      }
    ];
  }

  getPromptContext(event: SourceEvent): string {
    return `**Issue:** ${event.title}\n**Description:** ${event.description}`;
  }

  async updateStatus(event: SourceEvent, status: FixStatus): Promise<void> {
    // Update Linear issue status via API
  }

  async addComment(event: SourceEvent, comment: string): Promise<void> {
    // Add comment to Linear issue
  }

  getLink(event: SourceEvent): string {
    return `[Linear Issue](https://linear.app/issue/${event.sourceId})`;
  }
}
```

---

## Benefits

✅ **Extensible**: Add sources without changing core logic
✅ **Maintainable**: Each source is isolated
✅ **Testable**: Mock individual source plugins
✅ **Reusable**: Generic runner works for all sources
✅ **Scalable**: Easy to add new bug sources

---

## Migration from Original Plan

The generic architecture eliminates:

- ❌ `router/src/handlers/sentry-fix.ts`
- ❌ `router/src/handlers/github-issue.ts`
- ❌ `router/src/handlers/circleci-fix.ts`
- ❌ `agent-runner/tools/*` (static scripts)

And replaces with:

- ✅ `router/src/sources/*.ts` (pluggable sources)
- ✅ `router/src/runner/orchestrator.ts` (generic handler)
- ✅ Dynamic tool generation per source
- ✅ Single webhook endpoint `/webhooks/:sourceId`
