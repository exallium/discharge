# AI Bug Fixer Pipeline Design

## Overview

A GitHub-integrated automated bug fixing and feature planning system that supports both autonomous operation and interactive human review via GitHub's native PR interface.

### Goals

- **Auto-fix straightforward bugs** with minimal friction
- **Plan-and-review workflow** for complex changes via PR-based interaction
- **Asynchronous collaboration** — queue events while jobs are in flight, process as batches
- **Conversational continuity** — Claude maintains context across iterations within a PR

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              GitHub Webhooks                                │
│  (issues, issue_comment, pull_request_review, label, etc.)                  │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │
                                  ▼
                       ┌─────────────────────┐
                       │   Webhook Handler   │
                       │   (Express/Fastify) │
                       └──────────┬──────────┘
                                  │
                                  ▼
                       ┌─────────────────────┐
                       │    Event Router     │
                       │                     │
                       │  - Normalize event  │
                       │  - Determine route  │
                       │  - Check job lock   │
                       └──────────┬──────────┘
                                  │
                    ┌─────────────┴─────────────┐
                    ▼                           ▼
         ┌─────────────────────┐     ┌─────────────────────┐
         │   No active job     │     │   Job in flight     │
         │   → Enqueue job     │     │   → Queue event     │
         └─────────────────────┘     └─────────────────────┘
                    │                           │
                    ▼                           ▼
         ┌─────────────────────┐     ┌─────────────────────┐
         │      BullMQ         │     │   Redis Event List  │
         │   (job queue)       │     │   (per PR/issue)    │
         └─────────────────────┘     └─────────────────────┘
                    │
                    ▼
         ┌─────────────────────┐
         │      Worker         │
         │                     │
         │  - Load context     │
         │  - Run Claude       │
         │  - Apply result     │
         │  - Drain queue      │
         └─────────────────────┘
```

---

## Routing Logic

### Label-Based Routing

| Label | Behavior | Use Case |
|-------|----------|----------|
| `ai:plan` | Plan → review → iterate → execute | Features, refactors, ambiguous bugs |
| `ai:auto` | Bypass confidence check, auto-fix immediately | Override for known-simple fixes |
| `ai:assist` | Plan only, never auto-execute | Learning, sensitive code, review-only |
| *(no label)* | Confidence-based routing (default) | Most bugs |

### Confidence-Based Auto-Routing (Default Path)

When no explicit routing label is present, Claude assesses the fix and decides whether to auto-execute or request review.

```typescript
interface ConfidenceAssessment {
  score: number               // 0.0 - 1.0
  autoExecuteThreshold: number // e.g., 0.85
  factors: ConfidenceFactor[]
  recommendation: 'auto_execute' | 'request_review'
  reasoning: string
}

interface ConfidenceFactor {
  factor: string
  impact: 'positive' | 'negative' | 'neutral'
  weight: number
  description: string
}
```

#### Confidence Factors

| Factor | Impact | Weight | Notes |
|--------|--------|--------|-------|
| Clear reproduction steps | + | 0.10 | Issue contains steps to reproduce |
| Isolated to single file | + | 0.15 | Lower blast radius |
| Existing test coverage | + | 0.15 | Can verify fix doesn't break things |
| Touches auth/security code | - | 0.25 | High-risk area |
| Touches payments/billing | - | 0.25 | High-risk area |
| Multiple files affected | - | 0.10 | Higher complexity |
| Schema/migration changes | - | 0.20 | Requires careful review |
| Public API changes | - | 0.15 | Breaking change potential |
| Has similar past fix | + | 0.10 | Pattern recognition |

#### Routing Decision

```typescript
function determineRoute(
  labels: string[],
  confidence: ConfidenceAssessment
): 'auto_execute' | 'plan_review' {
  // Explicit overrides
  if (labels.includes('ai:plan') || labels.includes('ai:assist')) {
    return 'plan_review'
  }
  if (labels.includes('ai:auto')) {
    return 'auto_execute'
  }
  
  // Confidence-based
  return confidence.score >= confidence.autoExecuteThreshold
    ? 'auto_execute'
    : 'plan_review'
}
```

---

## Job State Machine

```
┌────────────────────────────────────────────────────────────────────────┐
│                           Job Lifecycle                                │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│   ┌─────────┐    trigger    ┌───────────┐    complete    ┌─────────┐  │
│   │  IDLE   │ ───────────▶  │  RUNNING  │ ────────────▶  │ DRAIN   │  │
│   └─────────┘               └───────────┘                └────┬────┘  │
│        ▲                          │                           │       │
│        │                          │ events accumulate         │       │
│        │                          ▼                           ▼       │
│        │                    ┌───────────┐              ┌───────────┐  │
│        │                    │  QUEUED   │              │  Process  │  │
│        │                    │  EVENTS   │              │  Pending  │  │
│        │                    └───────────┘              └─────┬─────┘  │
│        │                                                     │        │
│        │         queue empty              queue has events   │        │
│        └────────────────────────────────────────────────────▶│        │
│        │                                                     │        │
│        │                                    ┌────────────────┘        │
│        │                                    ▼                         │
│        │                             ┌─────────────┐                  │
│        │                             │ NEW JOB     │                  │
│        │                             │ (continue)  │                  │
│        │                             └──────┬──────┘                  │
│        │                                    │                         │
│        └────────────────────────────────────┘                         │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

### State Transitions

| From | To | Trigger |
|------|----|---------|
| IDLE | RUNNING | New GitHub event for this PR/issue |
| RUNNING | DRAIN | Claude completes current task |
| DRAIN | IDLE | No pending events in queue |
| DRAIN | RUNNING | Pending events exist → start new job |

---

## Redis Data Structures

```
# Job lock — prevents concurrent jobs for same PR
ai-fixer:lock:{owner}:{repo}:{number}
  → job ID (string)
  → TTL: 1 hour (safety fallback)

# Event queue — events that arrived while job was running  
ai-fixer:events:{owner}:{repo}:{number}
  → List of JSON-encoded events (RPUSH to add, LRANGE to read)

# Conversation context — persists across job iterations
ai-fixer:context:{owner}:{repo}:{number}
  → JSON blob (see Context schema below)
  → TTL: 7 days (configurable)
```

---

## Data Models

### GitHub Event (Normalized)

```typescript
interface GitHubEvent {
  id: string
  type: 
    | 'issue_opened'
    | 'issue_labeled'
    | 'issue_comment'
    | 'pr_opened'
    | 'pr_comment'
    | 'pr_review'
    | 'pr_review_comment'
    | 'push'
  
  repo: {
    owner: string
    name: string
    fullName: string  // "owner/repo"
  }
  
  // Polymorphic — either issue or PR context
  target: {
    type: 'issue' | 'pull_request'
    number: number
    title: string
    body: string
    labels: string[]
    author: string
  }
  
  // Event-specific payload
  payload: {
    action?: string
    comment?: { body: string; author: string; id: number }
    review?: { state: string; body: string; author: string }
    label?: { name: string }
  }
  
  timestamp: string  // ISO 8601
}
```

### Queued Event

```typescript
interface QueuedEvent {
  event: GitHubEvent
  queuedAt: string  // ISO 8601
}
```

### PR/Issue Context (Persisted)

```typescript
interface JobContext {
  owner: string
  repo: string
  number: number
  type: 'issue' | 'pull_request'
  
  // Current state
  status: 'planning' | 'reviewing' | 'executing' | 'complete' | 'failed'
  iteration: number
  
  // Plan tracking
  plan?: {
    path: string          // e.g., ".ai-bug-fixer/plans/PLAN-142.md"
    branch: string        // e.g., "ai/plan-142"
    prNumber?: number     // PR number for the plan file
    version: number
  }
  
  // Confidence assessment (for auto-routing)
  confidence?: ConfidenceAssessment
  
  // Claude conversation history (for continuity)
  messages: Array<{
    role: 'user' | 'assistant'
    content: string
    timestamp: string
  }>
  
  // Metadata
  createdAt: string
  updatedAt: string
}
```

### Plan File Schema

```typescript
interface PlanFile {
  // Frontmatter (YAML)
  metadata: {
    issue: number
    status: 'draft' | 'reviewing' | 'approved' | 'executing' | 'complete'
    iteration: number
    confidence: number
    created: string
    updated: string
    author: 'claude'
  }
  
  // Markdown body sections
  sections: {
    context: string       // Claude's understanding of the problem
    approach: string      // High-level strategy
    steps: PlanStep[]     // Detailed implementation steps
    risks: string[]       // What could go wrong
    questions: string[]   // Uncertainties for reviewer
  }
}

interface PlanStep {
  title: string
  description: string
  tasks: string[]         // Checkbox items
  files: string[]         // Files to be modified
  estimated_complexity: 'trivial' | 'low' | 'medium' | 'high'
}
```

---

## Plan File Format (Markdown)

```markdown
---
issue: 142
status: draft
iteration: 1
confidence: 0.72
created: 2025-01-12T14:30:00Z
updated: 2025-01-12T14:30:00Z
author: claude
---

# Plan: Fix Auth Token Expiry Bug (#142)

## Context

User reported that authentication fails silently when tokens expire during 
long-running sessions. The issue manifests as 401 errors without any retry 
or refresh attempt.

## Approach

Implement token refresh logic in the AuthService with exponential backoff 
retry for transient failures. Add explicit handling for the expiry case 
rather than treating it as a generic auth failure.

## Steps

### 1. Refactor AuthService Token Handling

**Complexity:** Medium  
**Files:** `src/services/auth.ts`, `src/types/auth.ts`

- [ ] Extract token validation into dedicated `validateToken()` method
- [ ] Add `isTokenExpired()` helper using JWT exp claim
- [ ] Implement `refreshToken()` method with retry logic

### 2. Add Retry Logic

**Complexity:** Low  
**Files:** `src/services/auth.ts`, `src/utils/retry.ts`

- [ ] Create generic retry utility with exponential backoff
- [ ] Apply to token refresh with max 3 attempts
- [ ] Add circuit breaker for repeated failures

### 3. Update Error Handling

**Complexity:** Low  
**Files:** `src/services/auth.ts`, `src/types/errors.ts`

- [ ] Add `TokenExpiredError` type
- [ ] Distinguish between expired vs invalid tokens in error responses
- [ ] Emit telemetry event on refresh attempts

### 4. Add Tests

**Complexity:** Medium  
**Files:** `src/services/__tests__/auth.test.ts`

- [ ] Test: expired token triggers refresh
- [ ] Test: refresh failure after max retries
- [ ] Test: successful refresh updates stored token
- [ ] Test: concurrent requests don't trigger multiple refreshes

## Risks

- **Race condition:** Multiple concurrent requests could trigger simultaneous 
  refresh attempts. Mitigation: Add mutex/lock around refresh logic.
- **Refresh token expiry:** If refresh token is also expired, user will need 
  to re-authenticate. Should show appropriate UX.

## Questions

1. Should we proactively refresh tokens before expiry (e.g., at 80% of TTL)?
2. Is there a preference for the retry library, or should this be hand-rolled?
3. Should telemetry include token age at refresh time?
```

---

## Webhook Handler

```typescript
import { Router } from 'express'
import { Queue } from 'bullmq'
import { Redis } from 'ioredis'
import crypto from 'crypto'

const router = Router()
const redis = new Redis(process.env.REDIS_URL)
const queue = new Queue('ai-fixer', { connection: redis })

// Verify GitHub webhook signature
function verifySignature(payload: string, signature: string): boolean {
  const expected = `sha256=${crypto
    .createHmac('sha256', process.env.GITHUB_WEBHOOK_SECRET!)
    .update(payload)
    .digest('hex')}`
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
}

router.post('/webhook', async (req, res) => {
  // Verify signature
  const signature = req.headers['x-hub-signature-256'] as string
  if (!verifySignature(JSON.stringify(req.body), signature)) {
    return res.status(401).send('Invalid signature')
  }
  
  const eventType = req.headers['x-github-event'] as string
  const payload = req.body
  
  // Normalize the event
  const event = normalizeGitHubEvent(eventType, payload)
  if (!event) {
    // Event type we don't care about
    return res.status(200).send('Ignored')
  }
  
  // Route the event
  await routeEvent(event)
  
  res.status(200).send('OK')
})

async function routeEvent(event: GitHubEvent): Promise<void> {
  const prKey = `${event.repo.fullName}:${event.target.number}`
  const lockKey = `ai-fixer:lock:${prKey}`
  const eventsKey = `ai-fixer:events:${prKey}`
  
  // Attempt to acquire lock atomically
  const jobId = `${prKey}-${Date.now()}`
  const acquired = await redis.set(lockKey, jobId, 'NX', 'EX', 3600)
  
  if (!acquired) {
    // Job in flight — queue the event
    await redis.rpush(eventsKey, JSON.stringify({
      event,
      queuedAt: new Date().toISOString(),
    }))
    console.log(`Queued event for ${prKey}`)
    return
  }
  
  // No active job — determine route and enqueue
  const route = await determineInitialRoute(event)
  
  await queue.add('process', {
    jobId,
    event,
    route,
    queuedEvents: [],
  }, {
    jobId,
  })
  
  console.log(`Started job ${jobId} with route: ${route}`)
}

async function determineInitialRoute(
  event: GitHubEvent
): Promise<'auto_fix' | 'plan_review'> {
  const labels = event.target.labels
  
  // Explicit label overrides
  if (labels.includes('ai:plan') || labels.includes('ai:assist')) {
    return 'plan_review'
  }
  if (labels.includes('ai:auto')) {
    return 'auto_fix'
  }
  
  // Default: will assess confidence during processing
  // Start with plan_review as safer default, worker will re-evaluate
  return 'plan_review'
}
```

---

## Worker Implementation

```typescript
import { Worker, Job } from 'bullmq'
import { Redis } from 'ioredis'
import { Octokit } from '@octokit/rest'

const redis = new Redis(process.env.REDIS_URL)
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN })

interface JobData {
  jobId: string
  event: GitHubEvent
  route: 'auto_fix' | 'plan_review'
  queuedEvents: QueuedEvent[]
}

const worker = new Worker<JobData>('ai-fixer', async (job: Job<JobData>) => {
  const { jobId, event, route, queuedEvents } = job.data
  const prKey = `${event.repo.fullName}:${event.target.number}`
  const lockKey = `ai-fixer:lock:${prKey}`
  const eventsKey = `ai-fixer:events:${prKey}`
  const contextKey = `ai-fixer:context:${prKey}`
  
  try {
    // Load existing context
    const existingContext = await redis.get(contextKey)
    const context: JobContext = existingContext 
      ? JSON.parse(existingContext)
      : createInitialContext(event)
    
    // Build Claude input
    const claudeInput = buildClaudeInput(event, queuedEvents, context)
    
    // Run Claude
    const result = await runClaude(claudeInput, route)
    
    // Apply results
    await applyResult(result, event, context)
    
    // Update context
    context.iteration++
    context.updatedAt = new Date().toISOString()
    context.messages.push(
      { role: 'user', content: claudeInput.userMessage, timestamp: new Date().toISOString() },
      { role: 'assistant', content: result.response, timestamp: new Date().toISOString() }
    )
    await redis.set(contextKey, JSON.stringify(context), 'EX', 7 * 24 * 60 * 60)
    
    // === DRAIN PHASE ===
    await drainEventQueue(prKey, lockKey, eventsKey, event, context)
    
  } catch (error) {
    console.error(`Job ${jobId} failed:`, error)
    
    // Post error comment to GitHub
    await postErrorComment(event, error)
    
    // Release lock
    await redis.del(lockKey)
    
    throw error
  }
}, {
  connection: redis,
  concurrency: 5,
})

async function drainEventQueue(
  prKey: string,
  lockKey: string,
  eventsKey: string,
  event: GitHubEvent,
  context: JobContext
): Promise<void> {
  // Atomically get and clear pending events
  const pending = await redis.lrange(eventsKey, 0, -1)
  
  if (pending.length === 0) {
    // No pending events — release lock, we're done
    await redis.del(lockKey)
    console.log(`Job complete for ${prKey}, lock released`)
    return
  }
  
  // Clear the queue
  await redis.del(eventsKey)
  
  // Parse queued events
  const queuedEvents: QueuedEvent[] = pending.map(e => JSON.parse(e))
  
  console.log(`Draining ${queuedEvents.length} queued events for ${prKey}`)
  
  // Start continuation job
  const newJobId = `${prKey}-${Date.now()}`
  
  await queue.add('process', {
    jobId: newJobId,
    event: {
      ...event,
      type: 'continuation' as any,
    },
    route: 'plan_review',  // Continuations always go through review path
    queuedEvents,
  }, {
    jobId: newJobId,
  })
  
  // Transfer lock to new job
  await redis.set(lockKey, newJobId, 'EX', 3600)
}
```

---

## Claude Integration

```typescript
interface ClaudeInput {
  systemPrompt: string
  userMessage: string
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>
}

interface ClaudeResult {
  response: string
  action: 
    | { type: 'create_plan'; plan: PlanFile; branch: string }
    | { type: 'update_plan'; changes: string }
    | { type: 'execute'; commits: CommitIntent[] }
    | { type: 'comment'; body: string }
    | { type: 'request_info'; questions: string[] }
  confidence?: ConfidenceAssessment
}

function buildClaudeInput(
  event: GitHubEvent,
  queuedEvents: QueuedEvent[],
  context: JobContext
): ClaudeInput {
  
  const systemPrompt = `You are an AI assistant integrated into a GitHub-based bug fixing pipeline.

Current context:
- Repository: ${event.repo.fullName}
- Issue/PR: #${event.target.number} - ${event.target.title}
- Status: ${context.status}
- Iteration: ${context.iteration}

Your capabilities:
1. Analyze issues and create implementation plans
2. Execute plans by generating commits
3. Respond to review feedback and iterate on plans
4. Assess your confidence in proposed fixes

Output your response as JSON matching the ClaudeResult schema.`

  // Build user message from event + queued events
  let userMessage = formatEventAsMessage(event)
  
  if (queuedEvents.length > 0) {
    userMessage += `\n\n---\n\nWhile processing, ${queuedEvents.length} additional events occurred:\n\n`
    userMessage += queuedEvents.map(qe => formatEventAsMessage(qe.event)).join('\n\n')
  }
  
  return {
    systemPrompt,
    userMessage,
    conversationHistory: context.messages,
  }
}

function formatEventAsMessage(event: GitHubEvent): string {
  switch (event.type) {
    case 'issue_opened':
      return `New issue opened:\n\nTitle: ${event.target.title}\n\nBody:\n${event.target.body}`
    
    case 'issue_comment':
    case 'pr_comment':
      return `Comment from @${event.payload.comment?.author}:\n\n${event.payload.comment?.body}`
    
    case 'pr_review':
      return `Review (${event.payload.review?.state}) from @${event.payload.review?.author}:\n\n${event.payload.review?.body}`
    
    case 'pr_review_comment':
      return `Inline review comment from @${event.payload.comment?.author}:\n\n${event.payload.comment?.body}`
    
    case 'issue_labeled':
      return `Label added: ${event.payload.label?.name}`
    
    default:
      return `Event: ${event.type}`
  }
}
```

---

## Applying Results

```typescript
async function applyResult(
  result: ClaudeResult,
  event: GitHubEvent,
  context: JobContext
): Promise<void> {
  const { owner, name } = event.repo
  const number = event.target.number
  
  switch (result.action.type) {
    case 'create_plan': {
      const { plan, branch } = result.action
      
      // Create branch
      const defaultBranch = await getDefaultBranch(owner, name)
      const ref = await octokit.git.getRef({
        owner, repo: name, ref: `heads/${defaultBranch}`
      })
      await octokit.git.createRef({
        owner, repo: name,
        ref: `refs/heads/${branch}`,
        sha: ref.data.object.sha,
      })
      
      // Create plan file
      const planPath = `.ai-bug-fixer/plans/PLAN-${number}.md`
      const planContent = renderPlanToMarkdown(plan)
      
      await octokit.repos.createOrUpdateFileContents({
        owner, repo: name,
        path: planPath,
        message: `Add implementation plan for #${number}`,
        content: Buffer.from(planContent).toString('base64'),
        branch,
      })
      
      // Create PR for the plan
      const pr = await octokit.pulls.create({
        owner, repo: name,
        title: `[AI Plan] ${event.target.title}`,
        body: `This PR contains an implementation plan for #${number}.\n\n` +
              `Please review the plan and:\n` +
              `- **Approve** to execute the plan\n` +
              `- **Request changes** with inline comments to iterate\n\n` +
              `Confidence: ${(result.confidence?.score ?? 0) * 100}%`,
        head: branch,
        base: defaultBranch,
      })
      
      // Update context
      context.plan = {
        path: planPath,
        branch,
        prNumber: pr.data.number,
        version: 1,
      }
      context.status = 'reviewing'
      break
    }
    
    case 'update_plan': {
      // Update the plan file in place
      if (!context.plan) throw new Error('No plan to update')
      
      const { data: file } = await octokit.repos.getContent({
        owner, repo: name,
        path: context.plan.path,
        ref: context.plan.branch,
      })
      
      if (!('sha' in file)) throw new Error('Expected file, got directory')
      
      await octokit.repos.createOrUpdateFileContents({
        owner, repo: name,
        path: context.plan.path,
        message: `Update plan (iteration ${context.iteration + 1})`,
        content: Buffer.from(result.action.changes).toString('base64'),
        sha: file.sha,
        branch: context.plan.branch,
      })
      
      context.plan.version++
      break
    }
    
    case 'execute': {
      // Apply commits
      for (const commit of result.action.commits) {
        await applyCommit(owner, name, context.plan?.branch ?? 'main', commit)
      }
      
      context.status = 'executing'
      break
    }
    
    case 'comment': {
      // Post a comment
      if (event.target.type === 'issue') {
        await octokit.issues.createComment({
          owner, repo: name,
          issue_number: number,
          body: result.action.body,
        })
      } else {
        await octokit.pulls.createReview({
          owner, repo: name,
          pull_number: number,
          body: result.action.body,
          event: 'COMMENT',
        })
      }
      break
    }
    
    case 'request_info': {
      const body = `I have some questions before proceeding:\n\n` +
        result.action.questions.map((q, i) => `${i + 1}. ${q}`).join('\n')
      
      await octokit.issues.createComment({
        owner, repo: name,
        issue_number: number,
        body,
      })
      break
    }
  }
}
```

---

## Review Processing

When a PR review comes in, extract inline comments with their context:

```typescript
async function extractReviewFeedback(
  owner: string,
  repo: string,
  prNumber: number,
  reviewId: number
): Promise<ReviewFeedback> {
  const { data: review } = await octokit.pulls.getReview({
    owner, repo,
    pull_number: prNumber,
    review_id: reviewId,
  })
  
  const { data: comments } = await octokit.pulls.listCommentsForReview({
    owner, repo,
    pull_number: prNumber,
    review_id: reviewId,
  })
  
  return {
    state: review.state,  // 'APPROVED', 'CHANGES_REQUESTED', 'COMMENTED'
    body: review.body,
    author: review.user?.login ?? 'unknown',
    inlineComments: comments.map(c => ({
      path: c.path,
      line: c.line ?? c.original_line,
      diffHunk: c.diff_hunk,
      body: c.body,
      author: c.user?.login ?? 'unknown',
    })),
  }
}

interface ReviewFeedback {
  state: string
  body: string | null
  author: string
  inlineComments: Array<{
    path: string
    line: number | undefined
    diffHunk: string
    body: string
    author: string
  }>
}
```

---

## Environment Variables

```bash
# Redis
REDIS_URL=redis://localhost:6379

# PostgreSQL (optional, for audit logging)
DATABASE_URL=postgresql://localhost:5432/ai-fixer

# GitHub
GITHUB_APP_ID=123456
GITHUB_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n..."
GITHUB_WEBHOOK_SECRET=your-webhook-secret

# For personal access token auth (simpler alternative to GitHub App)
GITHUB_TOKEN=ghp_xxxxxxxxxxxx

# Claude / Anthropic
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxx

# Confidence thresholds
AUTO_EXECUTE_THRESHOLD=0.85
```

---

## Error Handling

```typescript
async function postErrorComment(
  event: GitHubEvent,
  error: unknown
): Promise<void> {
  const message = error instanceof Error ? error.message : 'Unknown error'
  
  const body = `⚠️ **AI Bug Fixer encountered an error**\n\n` +
    `\`\`\`\n${message}\n\`\`\`\n\n` +
    `Please check the logs or retry by adding a comment.`
  
  await octokit.issues.createComment({
    owner: event.repo.owner,
    repo: event.repo.name,
    issue_number: event.target.number,
    body,
  })
}
```

---

## Future Considerations

- **Concurrent PR edits:** Handle cases where human pushes commits while Claude is working
- **Plan approval via comment:** Support `@bot approve` as alternative to PR approval
- **Partial execution:** Execute some steps, pause for review, continue
- **Cost tracking:** Monitor Claude API usage per repo/org
- **Audit log:** PostgreSQL table tracking all actions taken
- **Webhook replay:** Ability to replay missed webhooks on worker restart
- **Multi-repo support:** Handle events across multiple repositories
