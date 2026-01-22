# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Important Rules

- **Never make changes that will result in data loss without explicit permission.** This includes changing database credentials, dropping tables, modifying Docker volume configurations, or any other change that could destroy or make existing data inaccessible.

## Build & Development Commands

All commands run from the `router/` directory:

```bash
# Development
npm run dev:setup        # First-time: build agent runner Docker image
npm run dev:up           # Start postgres, redis, mcp + Next.js dev server
npm run dev:down         # Stop infrastructure
npm run worker:dev       # Start job worker (run in separate terminal)

# Building
npm run build            # Build Next.js app + worker

# Testing
npm test                 # Unit tests only (no Docker required)
npm run test:unit        # Same as above
npm run test:integration # Integration tests (requires Docker + Redis)
npm run test:all         # Unit + integration + e2e
npm run test:watch       # Watch mode
npm run test:coverage    # Generate coverage report
npm run test:e2e         # Playwright end-to-end tests

# Run a single test file
npx jest tests/unit/triggers/github-issues.test.ts

# Run tests matching a pattern
npx jest --testNamePattern="should validate webhook"

# Other
npm run typecheck        # TypeScript type checking
npm run lint             # ESLint
npm run db:studio        # Drizzle Studio (database viewer)
npm run db:generate      # Generate database migrations
npm run db:migrate       # Run database migrations
```

Docker commands from repository root:
```bash
docker-compose up -d                          # Development
docker-compose -f docker-compose.prod.yml up -d  # Production
```

## Architecture Overview

This is an **AI-powered bug fixing system** that receives webhooks from bug sources, runs AI agents to investigate and fix issues, then creates PRs with the fixes.

### Service-Oriented Architecture

The system uses a service-oriented plugin architecture with services in `packages/services/`:

1. **Trigger Services** (`packages/services/github/`, `sentry/`, `circleci/`)
   - Handle webhooks from bug sources
   - Convert external webhooks to normalized `TriggerEvent`
   - Post results back to source systems

2. **Runner Services** (`packages/services/claude-code/`)
   - Execute AI agents in Docker containers
   - Read analysis from `.claude/analysis.json` after execution

3. **VCS Integration** (`router/src/vcs/`)
   - Create PRs, add comments, update statuses
   - Currently GitHub-focused

### Core Components

- **Next.js App** (`router/app/`) - Web UI and API routes
- **Worker** (`router/src/worker.ts`) - Background job processor
- **Orchestrator** (`router/src/runner/orchestrator.ts`) - Core workflow
- **Service Locator** (`packages/service-locator/`) - Service discovery
- **Service SDK** (`packages/service-sdk/`) - Interface definitions

### Request Flow

```
Webhook → POST /api/webhooks/:triggerId → Parse → BullMQ Queue → Worker → Orchestrator:
  1. Load project config from database
  2. Execute runner (Claude Code in Docker)
  3. Parse .claude/analysis.json
  4. If fix found with high confidence → Create PR via VCS
  5. Post result comment to source
```

### Key Files

- `router/app/api/webhooks/` - Webhook API routes
- `router/app/api/health/` - Health check endpoint
- `router/src/runner/orchestrator.ts` - Core workflow: run AI, create PR, post results
- `router/src/runner/prompts.ts` - Prompt templates for AI agents
- `router/src/runner/bug-config.ts` - `.ai-bugs.json` schema and validation
- `router/src/queue/` - BullMQ job queue (Redis backend)
- `router/src/db/` - Drizzle ORM database schema
- `router/src/worker.ts` - Background job processor

### Repository Configuration (`.ai-bugs.json`)

Target repositories can include a `.ai-bugs.json` file to customize fix behavior:
- **Categories**: Different requirements/deliverables per bug type (UI, database, API, etc.)
- **Infrastructure**: Per-category setup/teardown commands (e.g., `supabase start`)
- **Labels**: Match issue labels to categories for automatic selection

The runner reads this file after cloning, matches labels to categories, and:
1. Spins up infrastructure if the category defines it
2. Injects category-specific requirements into the prompt
3. Tears down infrastructure in the finally block

### Job Queue

- BullMQ with Redis backend
- Queue name: `claude-fix-jobs`
- Rate limit: 10 jobs/minute
- Retry: 3 attempts with exponential backoff
- Default concurrency: 2 (configurable via `WORKER_CONCURRENCY`)

### Health Endpoints

- `GET /api/health` - Full system check (Redis, queue, services)
- `GET /api/ready` - Load balancer readiness
- `GET /api/live` - Kubernetes liveness

## Testing Conventions

- Unit tests in `router/tests/unit/` - mock all external dependencies
- Integration tests in `router/tests/integration/` - use real Docker + Redis
- E2E tests via Playwright - full browser testing
- Mock trigger in `router/tests/mocks/mock-trigger.ts` for testing

## Environment Variables

Core (required):
- `REDIS_URL` - Job queue backend
- `DATABASE_URL` - PostgreSQL connection string
- `DB_ENCRYPTION_KEY` - 32-byte hex string for encrypting secrets
- `SESSION_SECRET` - Random string for session cookies

Per-service (required only if using that service):
- GitHub: `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`
- Sentry: `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`
- CircleCI: `CIRCLECI_TOKEN`
- Claude Code Runner: Uses local OAuth via `claude auth` (no API key needed)

See `.env.example` for full configuration options.