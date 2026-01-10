# GitHub VCS Plugin

Integrates with GitHub to create pull requests for automated fixes.

## Overview

The GitHub VCS plugin uses the [Octokit REST API](https://octokit.github.io/rest.js) to interact with GitHub repositories. It handles:

1. Creating pull requests with automated fixes
2. Adding reviewers to PRs
3. Adding labels to PRs
4. Adding comments to PRs
5. Generating compare URLs for manual review

## Setup

### 1. Create a GitHub Personal Access Token

Create a GitHub Personal Access Token (classic) with the following scopes:

- `repo` - Full control of private repositories (includes PR creation)
  - `repo:status` - Access commit status
  - `repo_deployment` - Access deployment status
  - `public_repo` - Access public repositories
  - `repo:invite` - Access repository invitations

Alternatively, use a fine-grained token with these permissions:
- **Pull requests**: Read and write
- **Contents**: Read and write
- **Issues**: Read and write (for comments and labels)

Generate your token at: https://github.com/settings/tokens

### 2. Configure Environment Variable

Set the GitHub token as an environment variable:

```bash
export GITHUB_TOKEN=ghp_your_token_here
```

For GitHub Apps, you can use an installation access token instead.

### 3. VCS Plugin Auto-Initialization

The GitHub VCS plugin is automatically initialized on router startup if `GITHUB_TOKEN` is present:

```typescript
// router/src/vcs/index.ts
initializeVCS(); // Called on startup

// GitHub VCS is now available
const github = getVCSPlugin('github');
```

## Usage

### Creating a Pull Request

```typescript
import { getVCSPlugin } from './vcs';

const github = getVCSPlugin('github');

const pr = await github.createPullRequest(
  'owner',       // Repository owner
  'repo',        // Repository name
  'fix/bug-123', // Source branch (head)
  'main',        // Target branch (base)
  'Fix: Resolve null pointer exception',
  'This PR fixes the NPE in UserService...'
);

console.log(`PR created: ${pr.htmlUrl}`);
// Output: PR created: https://github.com/owner/repo/pull/42
```

### Adding Reviewers

```typescript
await github.requestReviewers(
  'owner',
  'repo',
  42,  // PR number
  ['alice', 'bob']
);
```

### Adding Labels

```typescript
await github.addLabels(
  'owner',
  'repo',
  42,  // PR number
  ['automated-fix', 'needs-review', 'bug']
);
```

### Adding Comments

```typescript
await github.addPRComment(
  'owner',
  'repo',
  42,  // PR number
  '✅ All tests passed! Ready for review.'
);
```

### Getting Compare URL

If PR creation fails, get a manual compare URL:

```typescript
const url = github.getCompareUrl(
  'owner',
  'repo',
  'main',
  'fix/bug-123'
);
// Returns: https://github.com/owner/repo/compare/main...fix/bug-123
```

## Project Configuration

Configure GitHub VCS in your project settings:

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
    reviewers: ['alice', 'bob'],      // Auto-request reviewers
    labels: ['automated-fix', 'bug'], // Auto-add labels
  },
  // ... triggers, constraints, etc.
}
```

## Complete Workflow Example

```typescript
import { getVCSPlugin } from './vcs';
import { formatPRBody } from './vcs/base';

const github = getVCSPlugin('github');
const project = findProjectById('my-app');

// Analysis result from Claude
const analysis = {
  canAutoFix: true,
  confidence: 'high',
  summary: 'Fixed null pointer exception',
  rootCause: 'User object not null-checked',
  proposedFix: 'Added null check before accessing user.name',
  filesInvolved: ['src/services/user.ts'],
  complexity: 'simple',
};

// Create PR
const pr = await github.createPullRequest(
  project.vcs.owner,
  project.vcs.repo,
  'fix/auto-npe-user-service',
  project.branch,
  'Fix: Null pointer exception in UserService',
  formatPRBody(analysis, sentryLink)
);

// Add reviewers (if configured)
if (project.vcs.reviewers) {
  await github.requestReviewers(
    project.vcs.owner,
    project.vcs.repo,
    pr.number,
    project.vcs.reviewers
  );
}

// Add labels (if configured)
if (project.vcs.labels) {
  await github.addLabels(
    project.vcs.owner,
    project.vcs.repo,
    pr.number,
    project.vcs.labels
  );
}

// Add summary comment
await github.addPRComment(
  project.vcs.owner,
  project.vcs.repo,
  pr.number,
  `✅ Automated fix created with ${analysis.confidence} confidence.`
);

console.log(`✅ PR created: ${pr.htmlUrl}`);
```

## API Methods

### Required (VCSPlugin Interface)

| Method | Description |
|--------|-------------|
| `createPullRequest()` | Create a pull request |
| `getCompareUrl()` | Generate compare URL |
| `formatRepoIdentifier()` | Format as "owner/repo" |
| `validate()` | Validate GitHub token |

### Additional (GitHub-Specific)

| Method | Description |
|--------|-------------|
| `addPRComment()` | Add comment to PR |
| `requestReviewers()` | Request PR reviewers |
| `addLabels()` | Add labels to PR |

## Validation

Test your GitHub token:

```typescript
const result = await github.validate();

if (result.valid) {
  console.log('✓ GitHub token is valid');
} else {
  console.error(`✗ GitHub token error: ${result.error}`);
}
```

The validation endpoint calls `GET /user` to verify authentication.

## Error Handling

All methods throw errors from the Octokit library. Common errors:

| Error | Cause | Solution |
|-------|-------|----------|
| `Bad credentials` | Invalid token | Regenerate token |
| `Not Found` | Repository doesn't exist or no access | Check repo name and token permissions |
| `Validation Failed` | Invalid parameters (e.g., branch doesn't exist) | Ensure branch is pushed |
| `Rate limit exceeded` | Too many requests | Wait or use GitHub App for higher limits |

Example error handling:

```typescript
try {
  const pr = await github.createPullRequest(...);
} catch (error: any) {
  if (error.status === 404) {
    console.error('Repository not found or no access');
  } else if (error.status === 422) {
    console.error('Validation failed - branch may not exist');
  } else {
    console.error(`GitHub API error: ${error.message}`);
  }
}
```

## Rate Limits

GitHub API rate limits:
- **Personal Access Token**: 5,000 requests/hour
- **GitHub App**: 15,000 requests/hour (recommended for production)

Check rate limit status:

```typescript
const { octokit } = github as any; // Access internal octokit instance
const { data } = await octokit.rateLimit.get();

console.log(`Remaining: ${data.rate.remaining}/${data.rate.limit}`);
console.log(`Resets at: ${new Date(data.rate.reset * 1000)}`);
```

## Testing

Run the GitHub VCS tests:

```bash
npm test -- github.test.ts
```

Tests cover:
- PR creation (success and failure cases)
- Comment addition
- Reviewer requests
- Label addition
- Validation
- Error handling

## GitHub Apps (Advanced)

For production deployments, consider using a GitHub App for:
- Higher rate limits (15,000 req/hour)
- More granular permissions
- Better audit logging

To use a GitHub App:

```typescript
import { createAppAuth } from '@octokit/auth-app';

const octokit = new Octokit({
  authStrategy: createAppAuth,
  auth: {
    appId: process.env.GITHUB_APP_ID,
    privateKey: process.env.GITHUB_PRIVATE_KEY,
    installationId: process.env.GITHUB_INSTALLATION_ID,
  },
});

const github = new GitHubVCS(octokit);
```

## Troubleshooting

### PR creation fails with "Validation Failed"

**Cause**: Branch doesn't exist on remote

**Solution**: Ensure the fix branch is pushed before creating PR:

```bash
git push origin fix/bug-123
```

### PR creation fails with "Not Found"

**Cause**: Repository doesn't exist or token lacks access

**Solution**:
1. Check repository name is correct
2. Verify token has `repo` scope
3. Ensure token owner has access to the repository

### Reviewers not added

**Cause**: Reviewers must be repository collaborators

**Solution**: Add reviewers as collaborators first:
- Settings → Collaborators → Add people

### Labels not added

**Cause**: Labels don't exist in repository

**Solution**: Create labels first:
- Issues → Labels → New label

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GITHUB_TOKEN` | Yes | Personal Access Token or App installation token |

## API Reference

See `router/src/vcs/base.ts` for the `VCSPlugin` interface that this plugin implements.

See [Octokit REST API docs](https://octokit.github.io/rest.js) for detailed API reference.
