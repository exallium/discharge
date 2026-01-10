# Trigger Plugin API Review

## Current API Analysis

### Interface Overview

The `TriggerPlugin` interface consists of **9 methods** (2 optional):

```typescript
interface TriggerPlugin {
  // Identification (2 properties)
  id: string;
  type: string;

  // Webhook handling (2 methods)
  validateWebhook(req: Request): Promise<boolean>;
  parseWebhook(payload: any): Promise<TriggerEvent | null>;

  // Investigation (2 methods)
  getTools(event: TriggerEvent): Tool[];
  getPromptContext(event: TriggerEvent): string;

  // Post-processing (3 methods)
  updateStatus(event: TriggerEvent, status: FixStatus): Promise<void>;
  addComment(event: TriggerEvent, comment: string): Promise<void>;
  getLink(event: TriggerEvent): string;

  // Filtering (1 optional method)
  shouldProcess?(event: TriggerEvent): Promise<boolean>;
}
```

## Strengths

### 1. Clear Separation of Concerns
- **Webhook handling**: Validation and parsing
- **Investigation**: Tools and context for Claude
- **Post-processing**: Status updates and comments
- **Filtering**: Optional pre-processing

Each method has a single, well-defined responsibility.

### 2. Normalized Event Structure
The `TriggerEvent` interface works well across different trigger types:

| Field | Sentry | GitHub Issues | CircleCI |
|-------|--------|---------------|----------|
| `triggerId` | Issue ID | Issue number | Job ID |
| `title` | Error message | Issue title | "Test failed on main" |
| `description` | Stack trace | Issue body | Test output/logs |
| `metadata.severity` | Error level | Label-based | Branch-based |
| `links.web` | Issue permalink | Issue URL | Job URL |

### 3. Flexible for Different Systems
- **Bug trackers** (Sentry, GitHub Issues): Full lifecycle support
- **CI/CD** (CircleCI): Some methods are no-ops, which is fine
- **Future triggers**: Easy to add new sources

### 4. Not Overcomplicated
- Only 7 required methods (2 optional)
- Each method is straightforward
- No deep inheritance hierarchies
- No complex generics or type gymnastics

## Potential Issues & Questions

### 1. Do we need separate `updateStatus` and `addComment`?

**Current approach:**
```typescript
await trigger.updateStatus(event, { fixed: true, prUrl: '...' });
await trigger.addComment(event, 'Fix submitted in PR #123');
```

**Alternative - Combined:**
```typescript
await trigger.reportFix(event, {
  fixed: true,
  prUrl: '...',
  comment: 'Fix submitted in PR #123'
});
```

**Analysis:**
- ✅ **Keep separate** - Sometimes you want to update status without a comment, or vice versa
- Use case: Update status immediately, add comment later with PR details
- CircleCI might only use comments (on the commit/PR), not status updates

**Recommendation:** Keep as-is

### 2. Is `getLink` too trivial to be a method?

**Current implementation:**
```typescript
getLink(event: TriggerEvent): string {
  return `[${event.title}](${event.links?.web})`;
}
```

**Analysis:**
- Most triggers will have similar implementations
- But different systems might format differently:
  - Sentry: `[TypeError in user.ts](url)`
  - GitHub: `Issue #42: Fix auth bug`
  - CircleCI: `Test job failed (duration: 2m 15s)`
- It's used in comments and PR descriptions

**Recommendation:** Keep as-is - provides formatting flexibility

### 3. Should `getTools` be optional?

**Current:** Required - every trigger must return `Tool[]`

**Analysis:**
- Every trigger should provide *some* investigation context
- Even if it's just a tool that displays the formatted event
- Forces plugin authors to think about what Claude needs
- Empty array is allowed but discouraged

**Recommendation:** Keep required

### 4. Is `id` vs `type` redundant?

**Current usage:**
```typescript
id = 'sentry';
type = 'sentry';
```

They're currently the same. Do we need both?

**Potential use cases for different values:**
- Multiple instances: `id: 'sentry-prod'`, `type: 'sentry'`
- Versioning: `id: 'sentry-v2'`, `type: 'sentry'`

**Current architecture:**
- Webhook endpoint: `/webhooks/:triggerId` (uses `id`)
- Worker lookup: `getTriggerByType(type)` (uses `type`)

**Analysis:**
- Having both provides flexibility for future multi-instance scenarios
- Minimal overhead (just one extra property)
- Makes intent clearer in different contexts

**Recommendation:** Keep both

### 5. Should we add more optional methods?

**Potential additions:**
```typescript
interface TriggerPlugin {
  // ... existing methods ...

  // Get additional context links (docs, monitoring, etc.)
  getRelatedLinks?(event: TriggerEvent): { title: string; url: string }[];

  // For CI/CD systems - get build artifacts, logs, screenshots
  getArtifacts?(event: TriggerEvent): Promise<Artifact[]>;

  // Retry/re-run the failed job (for CI/CD)
  retrigger?(event: TriggerEvent): Promise<boolean>;
}
```

**Analysis:**
- These could be useful but might be overengineering
- Current `raw` field in TriggerEvent allows custom extensions
- Can add these later if needed without breaking existing plugins

**Recommendation:** Don't add now - wait for concrete use cases

## How CircleCI Would Work

### Example CircleCI Implementation

```typescript
class CircleCITrigger implements TriggerPlugin {
  id = 'circleci';
  type = 'circleci';

  async parseWebhook(payload: any): Promise<TriggerEvent | null> {
    if (payload.type !== 'job-completed' || payload.job.status !== 'failed') {
      return null; // Only process failed jobs
    }

    return {
      triggerType: 'circleci',
      triggerId: payload.job.id,
      projectId: findProject(payload.project.slug).id,
      title: `${payload.job.name} failed on ${payload.pipeline.vcs.branch}`,
      description: await fetchJobLogs(payload.job.id),
      metadata: {
        severity: payload.pipeline.vcs.branch === 'main' ? 'critical' : 'high',
        tags: [payload.job.name, payload.pipeline.vcs.branch],
        environment: payload.pipeline.vcs.branch,
        jobName: payload.job.name,
        branch: payload.pipeline.vcs.branch,
        revision: payload.pipeline.vcs.revision,
      },
      links: {
        web: payload.job.url,
      },
      raw: payload,
    };
  }

  getTools(event: TriggerEvent): Tool[] {
    return [
      {
        name: 'get-test-output',
        description: 'Get full test output and logs',
        script: `#!/bin/bash
curl -H "Circle-Token: $CIRCLECI_TOKEN" \\
  "https://circleci.com/api/v2/job/${event.triggerId}/artifacts" | jq .
`,
      },
      {
        name: 'get-failed-tests',
        description: 'List failed test cases',
        script: `#!/bin/bash
# Parse JUnit XML from artifacts
curl -H "Circle-Token: $CIRCLECI_TOKEN" \\
  "https://circleci.com/api/v2/job/${event.triggerId}/tests" | \\
  jq '.items[] | select(.result == "failure")'
`,
      },
    ];
  }

  async updateStatus(event: TriggerEvent, status: FixStatus): Promise<void> {
    // CircleCI doesn't have "issues" to update status on
    // Could potentially re-run the job here, but that's better done after PR merge
    // No-op is fine
  }

  async addComment(event: TriggerEvent, comment: string): Promise<void> {
    // Add comment to the commit that triggered the failure
    const revision = event.metadata.revision;
    const vcs = getVCSPlugin(); // Get GitHub/GitLab plugin
    await vcs.addCommitComment(revision, comment);
  }

  getLink(event: TriggerEvent): string {
    const jobName = event.metadata.jobName;
    const branch = event.metadata.branch;
    return `[${jobName} on ${branch}](${event.links?.web})`;
  }
}
```

### Key Observations

1. **Works naturally** - All required methods have sensible implementations
2. **No-op methods are fine** - `updateStatus` can be empty
3. **Flexibility** - `addComment` delegates to VCS plugin (smart!)
4. **Tools are powerful** - Can fetch artifacts, test results, logs

## Recommendations

### Keep Current API ✅

The current `TriggerPlugin` interface is well-designed:

1. **Not overcomplicated** - 7 required methods, each with clear purpose
2. **Extensible** - Works for bug trackers, CI/CD, and future sources
3. **Flexible** - Methods that don't apply can be no-ops
4. **Well-separated** - Clear phases: validate → parse → investigate → fix → report

### Minor Improvements (Optional)

#### 1. Add documentation about no-ops

```typescript
/**
 * Update the status of the trigger source (issue, job, etc.)
 *
 * For bug trackers: Mark issue as resolved/fixed
 * For CI/CD: Could re-run the job (optional)
 *
 * NOTE: This method can be a no-op if status updates don't apply
 */
updateStatus(event: TriggerEvent, status: FixStatus): Promise<void>;
```

#### 2. Clarify `id` vs `type` usage

```typescript
/**
 * Unique identifier for this trigger instance
 * Used in webhook endpoints: /webhooks/:triggerId
 *
 * Usually same as `type`, but allows multiple instances
 * Example: 'sentry-prod', 'sentry-staging'
 */
id: string;

/**
 * Trigger type identifier
 * Used for worker routing and configuration
 *
 * Example: 'sentry', 'github-issues', 'circleci'
 */
type: string;
```

#### 3. Consider making `getLink` optional

It's always `[title](url)` for most triggers. Could have a default implementation.

```typescript
getLink?(event: TriggerEvent): string;

// In base trigger registry:
function getDefaultLink(event: TriggerEvent): string {
  return `[${event.title}](${event.links?.web || '#'})`;
}
```

But this is very minor - current approach is fine.

## Verdict: API is Well-Designed

✅ Keep the current interface
✅ No major changes needed
✅ Ready for CircleCI implementation
✅ Extensible for future triggers

The API strikes a good balance between:
- **Simplicity** - Not overcomplicated
- **Flexibility** - Works for different trigger types
- **Completeness** - Covers the full lifecycle
- **Pragmatism** - No-ops are acceptable

## Next Steps

1. Implement CircleCI trigger to validate the API in practice
2. Document common patterns (like delegating to VCS plugins)
3. Create a trigger plugin template/generator for new plugins
