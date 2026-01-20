# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Important Rules

- **Never make changes that will result in data loss without explicit permission.** This includes changing database credentials, dropping tables, modifying Docker volume configurations, or any other change that could destroy or make existing data inaccessible.

## Build & Development Commands

All commands run from the `router/` directory:

```bash
# Development
npm run dev              # Start with ts-node (hot reload)
npm run build            # Compile TypeScript

# Testing
npm test                 # Unit tests only (no Docker required)
npm run test:unit        # Same as above
npm run test:integration # Integration tests (requires Docker + Redis)
npm run test:all         # Unit + integration
npm run test:watch       # Watch mode
npm run test:coverage    # Generate coverage report

# Run a single test file
npx jest tests/unit/triggers/github-issues.test.ts

# Run tests matching a pattern
npx jest --testNamePattern="should validate webhook"
```

Docker commands from repository root:
```bash
docker-compose up -d                          # Development
docker-compose -f docker-compose.prod.yml up -d  # Production
```

## Architecture Overview

This is an **AI-powered bug fixing system** that receives webhooks from bug sources, runs AI agents to investigate and fix issues, then creates PRs with the fixes.

### Three Plugin Systems

1. **Triggers** (`router/src/triggers/`) - Receive webhooks from bug sources
   - Interface: `TriggerPlugin` in `base.ts`
   - Convert external webhooks to normalized `TriggerEvent`
   - Generate bash investigation tools for AI agents
   - Post results back to source systems

2. **Runners** (`router/src/runner/runners/`) - Execute AI agents
   - Interface: `RunnerPlugin` in `../base.ts`
   - Claude Code runner spawns Docker containers
   - Reads analysis from `.claude/analysis.json` after execution

3. **VCS** (`router/src/vcs/`) - Interact with version control
   - Interface: `VCSPlugin` in `base.ts`
   - Create PRs, add comments, update statuses

### Request Flow

```
Webhook → POST /webhooks/:triggerId → Parse → BullMQ Queue → Worker → Orchestrator:
  1. Load project config from config/projects.ts
  2. Generate investigation tools from trigger
  3. Execute runner (Claude Code in Docker)
  4. Parse .claude/analysis.json
  5. If fix found with high confidence → Create PR via VCS plugin
  6. Post result comment to source
```

### Key Files

- `router/src/index.ts` - Express app entry, initializes all plugins
- `router/src/config/projects.ts` - Repository configurations (triggers, runner settings, VCS)
- `router/src/runner/orchestrator.ts` - Core workflow: run AI, create PR, post results
- `router/src/runner/prompts.ts` - Prompt templates for AI agents
- `router/src/runner/bug-config.ts` - `.ai-bugs.json` schema and validation
- `router/src/queue/index.ts` - BullMQ job queue (Redis backend)

### Repository Configuration (`.ai-bugs.json`)

Target repositories can include a `.ai-bugs.json` file to customize fix behavior:
- **Categories**: Different requirements/deliverables per bug type (UI, database, API, etc.)
- **Infrastructure**: Per-category setup/teardown commands (e.g., `supabase start`)
- **Labels**: Match issue labels to categories for automatic selection

The runner reads this file after cloning, matches labels to categories, and:
1. Spins up infrastructure if the category defines it
2. Injects category-specific requirements into the prompt
3. Tears down infrastructure in the finally block

### Plugin Registration

Plugins self-register when imported. To add a new trigger/runner/VCS:
1. Implement the interface from `base.ts`
2. Export and import in `index.ts` to register
3. Add to project configs in `config/projects.ts`

### Job Queue

- BullMQ with Redis backend
- Queue name: `claude-fix-jobs`
- Rate limit: 10 jobs/minute
- Retry: 3 attempts with exponential backoff
- Default concurrency: 2 (configurable via `WORKER_CONCURRENCY`)

### Health Endpoints

- `GET /health` - Full system check (Redis, queue, plugins)
- `GET /ready` - Load balancer readiness
- `GET /live` - Kubernetes liveness

## Testing Conventions

- Unit tests in `router/tests/unit/` - mock all external dependencies
- Integration tests in `router/tests/integration/` - use real Docker + Redis
- Fixtures in `router/tests/fixtures/` - realistic webhook payloads
- Mock trigger in `router/tests/mocks/mock-trigger.ts` for testing

## Environment Variables

Core (required):
- `REDIS_URL` - Job queue backend
- `USER` - For Docker volume mounting

Per-plugin (required only if using that plugin):
- GitHub VCS/Trigger: `GITHUB_TOKEN`, `GITHUB_WEBHOOK_SECRET`
- Sentry Trigger: `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`
- CircleCI Trigger: `CIRCLECI_TOKEN`
- Claude Code Runner: Uses local OAuth via `claude auth` (no API key needed)

See `.env.example` for full configuration options.