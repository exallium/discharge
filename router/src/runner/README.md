# Runner Module

The runner module orchestrates automated bug fixing by coordinating Claude Code execution, prompt generation, tool management, and pull request creation.

## Overview

The runner is the core execution engine of the AI bug-fixer system. When a trigger (Sentry, GitHub, CircleCI) detects a bug, the runner:

1. **Generates tools** - Creates executable scripts for Claude to investigate the issue
2. **Builds prompts** - Constructs investigation prompts with context and decision criteria
3. **Runs Claude** - Executes Claude Code in an isolated Docker container
4. **Orchestrates workflow** - Coordinates the entire fix process from analysis to PR creation

## Architecture

```
runner/
├── claude/           # Docker container execution
│   ├── index.ts
│   └── README.md
├── orchestrator/     # Main workflow coordination
│   ├── index.ts
│   └── README.md
├── prompts/          # Prompt generation
│   ├── index.ts
│   └── README.md
├── tools/            # Tool script management
│   ├── index.ts
│   └── README.md
└── index.ts          # Module exports
```

## Components

| Component | Purpose | Documentation |
|-----------|---------|---------------|
| **Claude** | Execute Claude Code in Docker containers | [Claude Runner](./claude/README.md) |
| **Orchestrator** | Coordinate the complete fix workflow | [Orchestrator](./orchestrator/README.md) |
| **Prompts** | Build investigation prompts for Claude | [Prompts](./prompts/README.md) |
| **Tools** | Generate and validate tool scripts | [Tools](./tools/README.md) |

## Quick Start

### Import the Runner

```typescript
import { orchestrateFix } from './runner';
import { getTriggerPlugin } from './triggers';

// Get trigger plugin
const sentry = getTriggerPlugin('sentry');

// Parse event
const event = await sentry.parseWebhook(req.body);

// Orchestrate fix
const result = await orchestrateFix(sentry, event);

if (result.fixed) {
  console.log(`✅ Fixed! PR: ${result.prUrl}`);
} else {
  console.log(`❌ Not fixed: ${result.reason}`);
}
```

### Workflow Visualization

```
┌─────────────┐
│   Trigger   │ (Sentry, GitHub, CircleCI)
│   Plugin    │
└──────┬──────┘
       │ TriggerEvent
       ▼
┌─────────────────────────────────────────────────────────┐
│                    Orchestrator                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  1. Generate Tools                                      │
│     ├─ trigger.getTools(event)                          │
│     └─ validateTools(tools)                             │
│                                                         │
│  2. Build Prompt                                        │
│     ├─ buildInvestigationPrompt(trigger, event, tools)  │
│     └─ Include decision criteria                        │
│                                                         │
│  3. Run Claude                                          │
│     ├─ runClaudeInContainer(options)                    │
│     ├─ Clone repo, create branch                        │
│     ├─ Execute Claude in Docker                         │
│     └─ Parse analysis.json                              │
│                                                         │
│  4. Create PR                                           │
│     ├─ vcs.createPullRequest(...)                       │
│     ├─ Add labels, reviewers                            │
│     └─ Update trigger status                            │
│                                                         │
└─────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────┐
│  FixStatus  │ { fixed: true, prUrl: "...", analysis: {...} }
└─────────────┘
```

## Core Concepts

### Fix Workflow

The orchestrator coordinates this workflow:

```typescript
export async function orchestrateFix(
  trigger: TriggerPlugin,
  event: TriggerEvent
): Promise<FixStatus> {
  // 1. Get project config
  const project = findProjectById(event.projectId);

  // 2. Pre-flight checks (Docker available, image exists)
  await performPreflightChecks();

  // 3. Generate investigation tools
  const tools = trigger.getTools(event);
  validateTools(tools);

  // 4. Build investigation prompt
  const prompt = buildInvestigationPrompt(trigger, event, tools);

  // 5. Run Claude in container
  const result = await runClaudeInContainer({
    repoUrl: project.repo,
    branch: project.branch,
    prompt,
  });

  // 6. Handle analysis result
  if (result.analysis?.canAutoFix && result.hasCommit) {
    // Create PR via VCS plugin
    const pr = await vcs.createPullRequest(...);
    return { fixed: true, prUrl: pr.htmlUrl, analysis };
  }

  // 7. Post analysis comment if no fix
  await trigger.addComment(event, formatAnalysisComment(analysis));
  return { fixed: false, reason: 'low_confidence', analysis };
}
```

### Analysis Result

Claude produces an `analysis.json` file that determines the fix outcome:

```json
{
  "canAutoFix": true,
  "confidence": "high",
  "summary": "Null pointer exception in UserService",
  "rootCause": "User object not null-checked before accessing name",
  "proposedFix": "Add null check before user.name access",
  "filesInvolved": ["src/services/user.ts"],
  "complexity": "simple"
}
```

**Fix criteria**: `canAutoFix === true` AND `confidence === "high"` AND commit exists

### Docker Isolation

Claude runs in an isolated Docker container with:
- **Resource limits**: 2 CPUs, 4GB memory, 100 processes
- **Network access**: Internal network only
- **Workspace**: Temporary directory, cleaned up after execution
- **Timeout**: 10 minutes (configurable)

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Claude API key (for Docker container) |
| `GITHUB_TOKEN` | Optional | GitHub access for private repos |
| `SENTRY_AUTH_TOKEN` | Optional | Sentry API access (passed to Claude) |
| `CIRCLECI_TOKEN` | Optional | CircleCI API access (passed to Claude) |
| `HOST_USER` | Optional | User for Claude config mount (defaults to $USER) |

## Docker Setup

### Build the Claude Runner Image

```bash
# From project root
docker compose --profile build-only build
```

This creates `claude-runner:latest` with:
- Claude Code CLI installed
- Git configured
- Node.js and common development tools
- Resource constraints applied

### Network Configuration

The runner uses Docker network `claude-agent_internal` for container communication:

```bash
docker network create claude-agent_internal
```

## Pre-flight Checks

The orchestrator performs these checks before running Claude:

```typescript
// Check Docker is available
const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  throw new Error('Docker is not available');
}

// Check claude-runner image exists
const imageAvailable = await isClaudeRunnerImageAvailable();
if (!imageAvailable) {
  throw new Error('claude-runner:latest image not found');
}
```

## Error Handling

The runner handles failures at each stage:

| Failure | Action |
|---------|--------|
| Docker not available | Throw error, fail job |
| Image not found | Throw error with build instructions |
| Tool validation fails | Throw error, don't run Claude |
| Claude execution fails | Post error comment to trigger, return `fixed: false` |
| No analysis.json | Post warning comment, return `fixed: false` |
| Low confidence | Post analysis comment only, return `fixed: false` |
| No commit made | Post warning comment, return `fixed: false` |
| PR creation fails | Use compare URL instead, still mark as fixed |

## Integration with Other Modules

### Triggers

Triggers provide the event and tools:

```typescript
const tools = trigger.getTools(event);        // Investigation tools
const context = trigger.getPromptContext(event); // Issue description
const link = trigger.getLink(event);          // Link to issue
await trigger.updateStatus(event, status);    // Update issue status
await trigger.addComment(event, message);     // Post comments
```

### VCS

VCS plugins handle PR creation:

```typescript
const vcs = getVCSPlugin(project.vcs.type);
const pr = await vcs.createPullRequest(owner, repo, head, base, title, body);

// GitHub-specific features
if (vcs instanceof GitHubVCS) {
  await vcs.addLabels(owner, repo, pr.number, labels);
  await vcs.requestReviewers(owner, repo, pr.number, reviewers);
}
```

### Projects

Project configuration determines repo and VCS settings:

```typescript
const project = findProjectById(event.projectId);
// {
//   id: 'my-app',
//   repo: 'git@github.com:owner/my-app.git',
//   branch: 'main',
//   vcs: { type: 'github', owner: 'owner', repo: 'my-app' }
// }
```

## Testing

Run runner tests:

```bash
# All runner tests
npm test -- src/runner

# Specific component
npm test -- orchestrator.test.ts
npm test -- tools.test.ts
npm test -- prompts.test.ts
```

## Performance Considerations

- **Container startup**: ~2-5 seconds
- **Git clone**: Varies by repo size (use shallow clone)
- **Claude execution**: 1-10 minutes (depends on complexity)
- **Workspace cleanup**: Runs asynchronously, doesn't block
- **Total workflow**: Typically 2-12 minutes

## Debugging

Enable verbose logging:

```typescript
// In orchestrator
console.log(`[Orchestrator] Starting fix for ${event.triggerType}:${event.triggerId}`);
console.log(`[Orchestrator] Project: ${project.id}`);
console.log(`[Orchestrator] Generated ${tools.length} tools`);

// In Claude runner
console.log(`[${jobId}] Starting Claude container`);
console.log(`[${jobId}] Cloning repository...`);
console.log(`[${jobId}] Running Claude Code...`);
```

Check container logs:

```bash
# List containers
docker ps -a | grep claude-

# View logs for specific job
docker logs claude-a1b2c3d4
```

## Component Documentation

See individual component READMEs for detailed documentation:

- [Claude Runner](./claude/README.md) - Docker execution, workspace management
- [Orchestrator](./orchestrator/README.md) - Workflow coordination, status handling
- [Prompts](./prompts/README.md) - Prompt generation, decision criteria
- [Tools](./tools/README.md) - Tool generation, validation

## See Also

- [Trigger Plugins](../triggers/README.md) - Event sources
- [VCS Plugins](../vcs/README.md) - PR creation
- [Project Configuration](../config/projects.ts) - Repository settings
