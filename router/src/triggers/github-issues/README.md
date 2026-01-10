# GitHub Issues Trigger Plugin

Automatically investigate and fix bugs reported in GitHub Issues with configurable controls to prevent token usage drain.

## Features

- **Label-based filtering**: Only process issues with specific labels
- **Manual comment triggers**: Require explicit opt-in via comment
- **User allowlists**: Restrict who can trigger processing
- **Automatic status updates**: Posts comments with progress
- **Rich investigation tools**: API access for issue context

## Control Mechanisms

This plugin includes three control mechanisms to prevent runaway token usage:

### 1. Label-based Filtering

Only process issues that have specific labels:

```typescript
github: {
  issues: true,
  labels: ['ai-fix', 'claude'],
  requireLabel: true  // Issue MUST have one of these labels
}
```

**Behavior:**
- `requireLabel: true` - Issue is ignored unless it has one of the specified labels
- `requireLabel: false` or omitted - Any issue triggers processing, but specified labels can be used for priority

### 2. Comment-based Manual Trigger

Require a specific comment to trigger processing:

```typescript
github: {
  issues: true,
  commentTrigger: '/claude fix'  // Trigger when someone comments this
}
```

**Behavior:**
- Only processes issue when comment contains the trigger phrase
- Great for maintainer control - they decide when to use Claude
- Can be combined with label filtering

### 3. User Allowlist

Restrict who can trigger via comment:

```typescript
github: {
  issues: true,
  commentTrigger: '/claude fix',
  allowedUsers: ['alice', 'bob', 'charlie']  // Only these users can trigger
}
```

**Behavior:**
- Only GitHub users in the allowlist can trigger processing
- Prevents random contributors from consuming tokens
- Ideal for open source projects with many contributors

## Setup

### 1. Configure Project

Edit `router/src/config/projects.ts`:

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
    github: {
      issues: true,
      labels: ['bug', 'ai-fix'],
      requireLabel: true,
      commentTrigger: '/claude fix',
      allowedUsers: ['maintainer1', 'maintainer2']
    }
  }
}
```

### 2. Set Environment Variables

```bash
# Required
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
GITHUB_WEBHOOK_SECRET=your-webhook-secret-here
```

**GITHUB_TOKEN permissions needed:**
- `repo` (full access) or `public_repo` (for public repos only)
- Ability to read issues and post comments

### 3. Configure Webhook

1. Go to repository Settings → Webhooks → Add webhook
2. **Payload URL**: `https://your-domain/webhooks/github-issues`
3. **Content type**: `application/json`
4. **Secret**: Enter the same value as `GITHUB_WEBHOOK_SECRET`
5. **Events**: Select individual events:
   - ☑️ Issues
   - ☑️ Issue comments
6. Save webhook

## Configuration Strategies

### Strategy 1: Label-Only (Recommended for Open Source)

```typescript
github: {
  issues: true,
  labels: ['ai-fix'],
  requireLabel: true
}
```

**Use case:** Public repo, anyone can add label to request automated fix
**Token control:** Moderators must add label to trigger processing

### Strategy 2: Comment-Only (Explicit Opt-In)

```typescript
github: {
  issues: true,
  commentTrigger: '/claude fix'
}
```

**Use case:** Any issue can be fixed, but requires explicit command
**Token control:** Anyone can trigger, but must actively request it

### Strategy 3: Comment + Allowlist (Maximum Control)

```typescript
github: {
  issues: true,
  commentTrigger: '/claude fix',
  allowedUsers: ['alice', 'bob']
}
```

**Use case:** Private repo or strict token budget
**Token control:** Only specific maintainers can trigger processing

### Strategy 4: Hybrid (Label + Comment)

```typescript
github: {
  issues: true,
  labels: ['bug'],
  commentTrigger: '/claude fix',
  allowedUsers: ['alice', 'bob']
}
```

**Use case:** Auto-process bugs with label, OR manually trigger on any issue
**Token control:** Label triggers automatically, comment requires allowlist

## Webhook Flow

```
GitHub Issue Created
       ↓
Has trigger label? ──No──→ Ignored
       ↓ Yes
       ↓
Queue Claude Job
       ↓
Clone Repository
       ↓
Run Investigation Tools
   (get-issue-details,
    get-issue-comments,
    search-related-issues)
       ↓
Claude Analyzes Issue
       ↓
Create Fix + Tests
       ↓
Create Pull Request
       ↓
Post Comment on Issue
   "✅ Fix completed! PR: #123"
```

**Or via comment:**

```
User Comments "/claude fix"
       ↓
User in allowlist? ──No──→ Ignored
       ↓ Yes
       ↓
Queue Claude Job
   (same flow as above)
```

## Investigation Tools

Claude has access to 5 investigation tools for GitHub issues:

### 1. `get-issue-details`
Fetches full issue metadata including labels, assignees, milestones, etc.

### 2. `get-issue-comments`
Retrieves all comments on the issue for additional context.

### 3. `get-issue-events`
Gets timeline events: label additions, assignments, references from other issues/PRs.

### 4. `search-related-issues`
Searches for similar issues in the repository based on issue title keywords.

### 5. `get-repo-issues`
Lists recent open issues in the repository for broader context.

## Example Workflow

### Scenario: Open Source Project

**Configuration:**
```typescript
github: {
  issues: true,
  labels: ['ai-fix'],
  requireLabel: true
}
```

**Workflow:**
1. User reports bug: "Application crashes on invalid input"
2. Maintainer reviews issue, confirms it's suitable for automation
3. Maintainer adds `ai-fix` label
4. Webhook triggers → Claude investigates
5. Claude:
   - Reads issue details and comments
   - Searches for related issues
   - Clones repo and investigates code
   - Creates fix with tests
   - Opens PR with link to original issue
6. Claude posts comment: "✅ Fix completed! PR: #456"
7. Maintainer reviews PR, merges if good
8. Issue auto-closes when PR merges (via GitHub keywords in PR description)

### Scenario: Private Team Project

**Configuration:**
```typescript
github: {
  issues: true,
  commentTrigger: '/claude fix',
  allowedUsers: ['alice', 'bob']
}
```

**Workflow:**
1. Alice reports bug: "Export feature fails for large datasets"
2. Bob reviews and decides to use Claude
3. Bob comments: "/claude fix"
4. Webhook triggers → Claude investigates
5. Claude creates fix and PR
6. Alice and Bob review together

## Status Updates

Claude posts comments to keep you informed:

**Started:**
```
🤖 Claude is investigating this issue...
```

**In Progress:**
```
🔧 Working on a fix...
```

**Completed:**
```
✅ Fix completed!

Pull request: https://github.com/owner/repo/pull/123
```

**Failed:**
```
❌ Unable to automatically fix this issue.

[Error details]
```

## Troubleshooting

### Webhook not triggering

**Check webhook delivery:**
1. Go to Settings → Webhooks → Your webhook
2. Click "Recent Deliveries"
3. Check response status and body

**Common issues:**
- Signature mismatch: Verify `GITHUB_WEBHOOK_SECRET` matches webhook secret
- Wrong events: Ensure "Issues" and "Issue comments" are selected
- Incorrect URL: Must end with `/webhooks/github-issues`

### Issue not processing

**Check logs for:**
- `No project configured for repo: owner/repo` → Add project to `projects.ts`
- `GitHub issues trigger not enabled` → Set `github.issues: true` in config
- `Issue doesn't have required label` → Add label or set `requireLabel: false`
- `User not in allowedUsers list` → Add user or remove allowlist

### Token permissions

If Claude can't post comments:
- Verify `GITHUB_TOKEN` has `repo` scope
- Check token isn't expired: `curl -H "Authorization: Bearer $GITHUB_TOKEN" https://api.github.com/user`
- Ensure token user has write access to repository

## Security Considerations

### Webhook Signature Validation

**Always set `GITHUB_WEBHOOK_SECRET`**

This trigger **requires** webhook signature validation. Without it, anyone could send fake webhooks to trigger processing.

### Token Safety

**Never commit `GITHUB_TOKEN` to code**

- Store in `.env` file (git-ignored)
- Use environment variables in production
- Rotate tokens periodically

### User Allowlists

**Use `allowedUsers` for public repositories**

Prevents arbitrary token usage from random contributors. Only trusted maintainers can trigger processing.

## Rate Limiting

GitHub API has rate limits:
- **Authenticated**: 5,000 requests/hour
- **Search API**: 30 requests/minute

The investigation tools use:
- ~5 API calls per issue (details, comments, events, search)
- Well within limits for normal usage

For high-volume repositories, consider:
- Using `requireLabel: true` to filter issues
- Setting up `commentTrigger` for manual control
- Monitoring API usage: `https://api.github.com/rate_limit`

## Limitations

1. **No direct issue closure**: Claude creates PRs but doesn't close issues. Use GitHub keywords in PR description (e.g., "Closes #123") for auto-close on merge.

2. **Single repo per webhook**: Each repository needs its own webhook configuration.

3. **No issue reopening**: If an issue is reopened, it won't automatically retrigger unless `reopened` action is added to webhook events.

4. **Comment edit no-op**: Editing a comment doesn't retrigger. User must post new comment.

## Future Enhancements

Potential additions:
- [ ] Automatic label addition after processing
- [ ] Issue assignment to Claude bot account
- [ ] Reaction emoji acknowledgment (👀 when started)
- [ ] Configurable comment templates
- [ ] Issue templates parsing for structured data
- [ ] Multiple comment triggers (e.g., "/claude fix", "/claude investigate")
