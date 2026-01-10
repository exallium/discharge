# Sentry Trigger Plugin

Automatically investigate and fix bugs reported by Sentry.

## Overview

The Sentry trigger plugin integrates with [Sentry](https://sentry.io) to automatically create fix jobs when new issues are reported. When Sentry detects an error, it sends a webhook to this router, which:

1. Validates the webhook signature
2. Parses the issue data
3. Creates investigation tools for Claude
4. Queues a fix job
5. Updates the Sentry issue when fixed

## Setup

### 1. Configure Sentry Auth Token

Create a Sentry auth token with the following permissions:
- `project:read` - Read project data
- `event:read` - Read error events
- `issue:write` - Update issue status and add comments

Set the token as an environment variable:

```bash
export SENTRY_AUTH_TOKEN=your_sentry_auth_token_here
```

### 2. Configure Webhook Secret (Optional but Recommended)

Generate a webhook secret for signature validation:

```bash
export SENTRY_WEBHOOK_SECRET=your_webhook_secret_here
```

### 3. Add Project Configuration

Add your Sentry project to `router/src/config/projects.ts`:

```typescript
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
    sentry: {
      projectSlug: 'my-app-prod',  // Your Sentry project slug
      enabled: true,
    },
  },
}
```

### 4. Configure Sentry Webhook

In your Sentry project settings:

1. Navigate to **Settings** → **Developer Settings** → **Webhooks**
2. Click **Create New Webhook**
3. Set the webhook URL to: `https://your-router-domain/webhooks/sentry`
4. Enable the **issue** event type (specifically `issue.created`)
5. Set the webhook secret (if configured in step 2)
6. Save the webhook

## Features

### Webhook Validation

- Validates webhook signatures using HMAC SHA256
- Accepts unsigned webhooks in development (logs warning)
- Rejects webhooks with invalid signatures

### Issue Filtering

The plugin automatically filters issues based on severity:

- **Processes**: `error`, `fatal`, `warning` level issues
- **Skips**: `debug`, `info` level issues
- **Skips**: Non-`created` events (resolved, assigned, etc.)

### Investigation Tools

Claude receives the following tools to investigate Sentry issues:

1. **get-sentry-issue** - Fetch full issue details via Sentry API
2. **get-sentry-events** - Get recent event occurrences with stack traces
3. **get-latest-event** - Get the most recent event with full context
4. **show-issue-summary** - Display formatted issue summary

### Severity Mapping

Sentry levels are mapped to our normalized severity scale:

| Sentry Level | Normalized Severity |
|--------------|---------------------|
| `fatal`      | `critical`          |
| `error`      | `critical`          |
| `warning`    | `high`              |
| `info`       | `medium`            |
| `debug`      | `low`               |

### Status Updates

When a fix is successfully applied:

1. Issue is marked as **Resolved** in Sentry
2. Resolution is tagged with `inRelease: 'latest'`
3. A comment is added with the PR URL

## Webhook Payload Example

```json
{
  "action": "created",
  "data": {
    "issue": {
      "id": "12345",
      "title": "TypeError: Cannot read property 'name' of undefined",
      "level": "error",
      "platform": "javascript",
      "culprit": "src/services/user.ts in getUser",
      "permalink": "https://sentry.io/organizations/my-org/issues/12345/",
      "metadata": {
        "type": "TypeError",
        "value": "Cannot read property 'name' of undefined"
      },
      "tags": [
        { "key": "environment", "value": "production" },
        { "key": "browser", "value": "Chrome" }
      ]
    },
    "project": {
      "slug": "my-app-prod",
      "name": "My Application"
    }
  }
}
```

## Testing

Run the Sentry trigger tests:

```bash
npm test -- sentry.test.ts
```

## Troubleshooting

### Webhook not being received

1. Check that the webhook URL is correct and publicly accessible
2. Verify the webhook is enabled for `issue.created` events
3. Check router logs for incoming webhook attempts

### Issues not being processed

1. Verify `SENTRY_AUTH_TOKEN` is set correctly
2. Check that the Sentry project slug matches your configuration
3. Ensure the issue level is `error`, `fatal`, or `warning` (not `debug` or `info`)
4. Check that the issue event is `created` (not `resolved`, `assigned`, etc.)

### Signature validation failing

1. Verify `SENTRY_WEBHOOK_SECRET` matches the secret in Sentry settings
2. Ensure the secret is set in both Sentry and your environment
3. Check for any proxy/load balancer that might modify the request body

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SENTRY_AUTH_TOKEN` | Yes | Auth token for Sentry API access |
| `SENTRY_WEBHOOK_SECRET` | Recommended | Secret for webhook signature validation |

## API Reference

See `router/src/triggers/base.ts` for the `TriggerPlugin` interface that this plugin implements.
