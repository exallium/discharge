# CircleCI Trigger Plugin

Automatically investigate and fix failed CI/CD workflows and test failures detected by CircleCI.

## Overview

The CircleCI trigger plugin integrates with CircleCI webhooks to automatically trigger bug fixes when:
- Workflows fail
- Jobs fail
- Tests fail in CI/CD pipelines

When a failure is detected, the plugin:
1. Parses the CircleCI webhook payload
2. Generates investigation tools for accessing CircleCI API data
3. Triggers the automated fix workflow
4. Provides test results and failure context to Claude

## Setup

### 1. Create a CircleCI Personal API Token

Create a CircleCI API token for accessing workflow and test data:

1. Go to CircleCI User Settings → Personal API Tokens
2. Click "Create New Token"
3. Name it "AI Bug Fixer" or similar
4. Save the token securely

**Token URL:** https://app.circleci.com/settings/user/tokens

### 2. Configure Environment Variable

Set the CircleCI token as an environment variable:

```bash
export CIRCLECI_TOKEN=your_circleci_token_here
```

### 3. Set Up Webhook in CircleCI

Configure CircleCI to send webhooks to your router:

1. Go to your CircleCI project settings
2. Navigate to "Webhooks"
3. Click "Add Webhook"
4. Configure:
   - **Name:** AI Bug Fixer
   - **Webhook URL:** `https://your-domain/webhooks/circleci`
   - **Events:** Select:
     - ✅ `workflow-completed`
     - ✅ `job-completed`
   - **Signing Secret:** Generate a random string (optional but recommended)
5. Save the webhook

**Documentation:** https://circleci.com/docs/webhooks/

### 4. Configure Webhook Secret (Optional but Recommended)

If you set a signing secret in CircleCI, configure it:

```bash
export CIRCLECI_WEBHOOK_SECRET=your_signing_secret_here
```

This enables signature validation to ensure webhooks are genuine.

### 5. Configure Project

Add CircleCI trigger configuration to your project:

```typescript
// router/src/config/projects.ts
{
  id: 'my-app',
  repo: 'git@github.com:owner/my-app.git',
  repoFullName: 'owner/my-app',
  branch: 'main',
  vcs: {
    type: 'github',
    owner: 'owner',
    repo: 'my-app',
  },
  triggers: {
    circleci: {
      enabled: true,
      projectSlug: 'gh/owner/my-app', // CircleCI project slug
    },
  },
}
```

## How It Works

### Webhook Flow

```
CircleCI Workflow Fails
    │
    ▼
CircleCI sends webhook
    │
    ▼
Router receives at /webhooks/circleci
    │
    ▼
CircleCITrigger.validateWebhook()
    │ (validates signature)
    ▼
CircleCITrigger.parseWebhook()
    │ (extracts failure details)
    ▼
CircleCITrigger.shouldProcess()
    │ (only process failures)
    ▼
Queue job for fixing
    │
    ▼
Generate investigation tools
    │ (API tools for CircleCI data)
    ▼
Run Claude with context
    │
    ▼
Create PR with fix
```

### Supported Events

| Event Type | Triggered When | What Gets Fixed |
|------------|----------------|-----------------|
| `workflow-completed` | Entire workflow fails | All failed jobs in workflow |
| `job-completed` | Specific job fails | Failed tests in that job |

### Webhook Payload Processing

**Workflow Failed:**
```json
{
  "type": "workflow-completed",
  "workflow": {
    "id": "workflow-123",
    "name": "build-and-test",
    "status": "failed",
    "url": "https://app.circleci.com/..."
  },
  "pipeline": {
    "project_slug": "gh/owner/repo",
    "vcs": {
      "branch": "feature/new-feature",
      "revision": "abc123",
      "commit": {
        "subject": "Add new feature"
      }
    }
  }
}
```

**Parsed Event:**
```typescript
{
  triggerType: 'circleci',
  triggerId: 'workflow-123',
  projectId: 'my-app',
  title: 'Failed workflow: build-and-test',
  description: 'Workflow failed on branch feature/new-feature',
  metadata: {
    severity: 'high',
    workflowName: 'build-and-test',
    branch: 'feature/new-feature',
    commitMessage: 'Add new feature',
    status: 'failed'
  }
}
```

## Investigation Tools

The CircleCI trigger generates specialized tools for Claude to investigate failures:

### get-workflow

Fetches complete workflow details including timing and status:

```bash
get-workflow
```

**Output:**
```json
{
  "id": "workflow-123",
  "name": "build-and-test",
  "status": "failed",
  "created_at": "2024-01-15T10:00:00Z",
  "stopped_at": "2024-01-15T10:30:00Z"
}
```

### get-workflow-jobs

Lists all jobs in the workflow with their statuses:

```bash
get-workflow-jobs
```

**Output:**
```json
[
  {
    "name": "build",
    "status": "success"
  },
  {
    "name": "test",
    "status": "failed"
  }
]
```

### get-job-details

Gets detailed job information including steps:

```bash
get-job-details
```

**Output:**
```json
{
  "id": "job-456",
  "name": "test",
  "status": "failed",
  "duration": 180,
  "steps": [
    {
      "type": "test",
      "message": "Test suite failed"
    }
  ]
}
```

### get-test-results

Retrieves failed test results with error messages:

```bash
get-test-results
```

**Output:**
```json
[
  {
    "classname": "UserServiceTest",
    "name": "testGetUser",
    "result": "failure",
    "message": "Expected user.name to equal 'John', but got undefined",
    "file": "tests/user.test.ts"
  }
]
```

### get-pipeline

Gets pipeline information including VCS details:

```bash
get-pipeline
```

## Example Workflow

### 1. Test Fails in CI

```javascript
// tests/user.test.ts
test('should get user by id', () => {
  const user = userService.getUser('123');
  expect(user.name).toBe('John'); // FAILS: user is undefined
});
```

### 2. CircleCI Sends Webhook

```json
{
  "type": "job-completed",
  "job": {
    "name": "test",
    "status": "failed"
  },
  "workflow": {
    "name": "build-and-test"
  }
}
```

### 3. Investigation Tools Generated

Claude gets access to:
- `get-workflow-jobs` - See which jobs failed
- `get-test-results` - Get specific test failures
- `get-job-details` - Understand execution context

### 4. Claude Investigates

```bash
$ get-test-results
{
  "name": "testGetUser",
  "result": "failure",
  "message": "Expected user.name to equal 'John', but got undefined"
}
```

Claude identifies: User object is undefined, likely null check missing.

### 5. Fix Applied

```javascript
// src/services/user.ts
getUserById(id) {
  const user = this.db.findUser(id);

  // Added null check
  if (!user) {
    throw new Error(`User ${id} not found`);
  }

  return user;
}
```

### 6. PR Created

```markdown
## Automated Fix

[CircleCI build-and-test](https://app.circleci.com/...)

### Analysis

- **Root Cause:** Missing null check in getUserById
- **Confidence:** high
- **Complexity:** simple

### Changes

Added null check before accessing user properties

### Test Fixed

- `UserServiceTest.testGetUser` - Now passes ✓
```

## Project Configuration

### Basic Configuration

```typescript
{
  id: 'my-app',
  triggers: {
    circleci: {
      enabled: true,
      projectSlug: 'gh/owner/my-app',
    },
  },
}
```

### Advanced Configuration

```typescript
{
  id: 'my-app',
  triggers: {
    circleci: {
      enabled: true,
      projectSlug: 'gh/owner/my-app',

      // Optional: Only trigger on specific workflows
      workflows: ['build-and-test', 'integration-tests'],

      // Optional: Only trigger on specific branches
      branches: ['main', 'develop'],

      // Optional: Ignore specific jobs
      ignoreJobs: ['deploy', 'publish'],
    },
  },
}
```

## Severity Mapping

All CircleCI failures are mapped to **high** severity since failed CI/CD indicates broken functionality.

| CircleCI Status | Severity | Auto-Fix |
|-----------------|----------|----------|
| `failed` | high | Yes |
| `success` | - | No |
| `running` | - | No |
| `on_hold` | - | No |

## Limitations

### No Direct Status Updates

CircleCI webhooks are one-way - the plugin cannot directly update workflow/job status. Status updates happen through:
- GitHub commit status API (if using GitHub)
- PR comments
- Re-running the workflow automatically triggers new status

### No Direct Comments

Unlike Sentry or GitHub Issues, CircleCI doesn't support comments on workflows. Instead:
- Comments are added to the VCS (GitHub PR, commit)
- Status is updated via VCS provider
- Links to CircleCI workflow are included in PR body

### Limited Test Context

CircleCI test results API provides:
- Test name and failure message
- File path (sometimes)
- Classname

But may not include:
- Full stack traces (need to fetch job logs)
- Test source code context
- Detailed error metadata

## Troubleshooting

### Webhook Not Received

**Check:**
1. Webhook URL is correct: `https://your-domain/webhooks/circleci`
2. CircleCI webhook is enabled
3. Selected events include `workflow-completed` and `job-completed`
4. Router is accessible from CircleCI (not localhost)

**Test Webhook:**
```bash
curl -X POST https://your-domain/webhooks/circleci \
  -H "Content-Type: application/json" \
  -d '{"type":"workflow-completed","workflow":{"id":"test-123","name":"test","status":"failed"},"pipeline":{"project_slug":"gh/owner/repo"}}'
```

### Signature Validation Failing

**Cause:** Webhook secret mismatch

**Solution:**
1. Check `CIRCLECI_WEBHOOK_SECRET` matches CircleCI webhook secret
2. Ensure secret is the same used when creating the webhook
3. Verify no extra whitespace in environment variable

### Project Not Found

**Cause:** Project slug mismatch

**Solution:**
1. Check `projectSlug` in project config matches CircleCI
2. Format should be: `gh/owner/repo` (for GitHub) or `bb/owner/repo` (for Bitbucket)
3. Check CircleCI webhook payload for correct slug

### Tools Returning Errors

**Cause:** Invalid `CIRCLECI_TOKEN` or missing permissions

**Solution:**
1. Verify token is valid: https://app.circleci.com/settings/user/tokens
2. Ensure token has read access to projects
3. Check token hasn't expired
4. Verify org/project permissions

### Test Results Not Available

**Cause:** Tests didn't upload results to CircleCI

**Solution:**
Ensure your `.circleci/config.yml` stores test results:

```yaml
- run:
    name: Run Tests
    command: npm test
- store_test_results:
    path: test-results
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CIRCLECI_TOKEN` | Yes | Personal API token for accessing CircleCI API |
| `CIRCLECI_WEBHOOK_SECRET` | No | Webhook signing secret (recommended for production) |

## API Reference

See `router/src/triggers/base.ts` for the `TriggerPlugin` interface that this plugin implements.

CircleCI API documentation: https://circleci.com/docs/api/v2/

## See Also

- [Trigger Plugin Architecture](../README.md) - Overview of trigger system
- [Sentry Trigger](../sentry/README.md) - Error monitoring integration
- [Project Configuration](../../config/projects.ts) - Configure projects
