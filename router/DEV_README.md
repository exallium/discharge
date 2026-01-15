# Development Setup

## Prerequisites

- Node.js 20+
- Docker & Docker Compose
- A GitHub personal access token (for testing GitHub triggers)

## First-Time Setup

### 1. Install dependencies

```bash
cd router
npm install
```

### 2. Create environment file

```bash
cp .env.example .env.dev
```

Edit `.env.dev` and set required values:
- `DB_ENCRYPTION_KEY` - 32-byte hex string for encrypting secrets
- `SESSION_SECRET` - Random string for session cookies
- `POSTGRES_PASSWORD` - Database password

### 3. Run first-time setup

This builds the agent runner Docker image (only needed once):

```bash
npm run dev:setup
```

### 4. Start infrastructure

```bash
npm run dev:up
```

This starts:
- PostgreSQL (database)
- Redis (job queue)
- Next.js dev server (web UI + API)

### 5. Start the worker (separate terminal)

```bash
npm run worker:dev
```

This processes queued jobs and runs AI agents.

## Two Terminal Setup

You need **two terminals** for local development:

| Terminal 1 | Terminal 2 |
|------------|------------|
| `npm run dev:up` | `npm run worker:dev` |
| Web server + API | Job processor |

## Useful Commands

```bash
# Stop infrastructure
npm run dev:down

# Run tests
npm test

# Type check
npm run typecheck

# Lint
npm run lint

# View database (Drizzle Studio)
npm run db:studio
```

## Docker Services

The full `docker-compose.yml` includes:

| Service | Description | Dev Usage |
|---------|-------------|-----------|
| `postgres` | Database | Started by `dev:up` |
| `redis` | Job queue | Started by `dev:up` |
| `web` | Next.js app | Run locally via `dev:up` |
| `worker` | Job processor | Run locally via `worker:dev` |
| `agent-runner-claude` | AI agent container | Must be built first |
| `tunnel` | Cloudflare tunnel | Optional, for webhooks |

## Testing Webhooks Locally

To receive webhooks from GitHub locally, you need a tunnel:

### Option 1: Cloudflare Tunnel (recommended)

1. Create a tunnel at https://one.dash.cloudflare.com/
2. Configure `cloudflared/config.yml`
3. Start the tunnel: `docker compose up tunnel`

### Option 2: ngrok

```bash
ngrok http 3000
```

## Troubleshooting

### "agent-runner-claude:latest image not found"

Run: `docker compose --profile build-only build`

### "GITHUB_TOKEN not configured"

Add to `.env.dev` or configure in project secrets via the admin UI.

### Worker not processing jobs

Make sure you're running `npm run worker:dev` in a separate terminal.

### ESM/import errors in worker

The worker uses a separate tsconfig. If you see import errors, ensure you're using `npm run worker:dev` (not running ts-node directly).
