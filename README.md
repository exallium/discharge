# Claude Agent - Automated Bug Fixer

A self-hosted automation system that uses Claude Code to automatically investigate and fix bugs from various sources (Sentry, GitHub Issues, CircleCI, etc.).

## 🏗️ Architecture

This project uses a **plugin-based architecture** where bug sources are modular and the Claude runner is completely generic. See [GENERIC_ARCHITECTURE.md](./GENERIC_ARCHITECTURE.md) for detailed design documentation.

### Key Components

- **Router** (Express/TypeScript): Webhook handlers, job queue, container orchestration
- **Claude Runner** (Docker): Claude Code CLI with dynamically mounted tools
- **Redis**: Job queue storage via BullMQ
- **Cloudflare Tunnel**: Public webhook access
- **Monitoring**: Portainer (Docker UI) + Dozzle (logs)

## 📁 Project Structure

```
claude-agent/
├── router/                      # Main application
│   ├── src/
│   │   ├── index.ts            # Express app entry
│   │   ├── config/             # Project configurations
│   │   ├── sources/            # Source plugins (Sentry, GitHub, etc.)
│   │   ├── webhooks/           # Generic webhook handlers
│   │   ├── queue/              # BullMQ job queue
│   │   ├── runner/             # Claude container orchestration
│   │   ├── services/           # External API clients
│   │   ├── health/             # Auth monitoring
│   │   └── utils/              # Utilities
│   ├── Dockerfile
│   └── package.json
│
├── claude-runner/               # Claude Code container
│   ├── Dockerfile
│   └── tools/                  # (Dynamically mounted per job)
│
├── cloudflared/                # Tunnel configuration
│   └── config.yml
│
├── docker-compose.yml
├── .env.example
└── .gitignore
```

## 🚀 Quick Start

### Prerequisites

- Node.js 20+
- Docker / OrbStack
- Claude Code CLI (with authenticated session)

### 1. Clone and Setup

```bash
git clone <your-repo>
cd claude-agent

# Copy environment template
cp .env.example .env

# Edit .env with your tokens
nano .env
```

### 2. Install Dependencies

```bash
cd router
npm install
```

### 3. Build and Run

```bash
# Build Docker images
docker compose --profile build-only build

# Start services
docker compose up -d

# View logs
docker compose logs -f router
```

### 4. Verify Setup

- Health Check: http://localhost:3000/health
- Dashboard: http://localhost:3000/dashboard
- Webhook List: http://localhost:3000/webhooks

## 🔌 Adding a Source Plugin

All bug sources implement the `SourcePlugin` interface:

```typescript
interface SourcePlugin {
  id: string;
  type: string;

  validateWebhook(req: Request): Promise<boolean>;
  parseWebhook(payload: any): Promise<SourceEvent | null>;
  getTools(event: SourceEvent): Tool[];
  getPromptContext(event: SourceEvent): string;
  updateStatus(event: SourceEvent, status: FixStatus): Promise<void>;
  addComment(event: SourceEvent, comment: string): Promise<void>;
  getLink(event: SourceEvent): string;
}
```

### Example: Adding Sentry

1. Create `router/src/sources/sentry.ts`
2. Implement `SourcePlugin` interface
3. Register in `router/src/sources/index.ts`
4. Configure webhook to `POST /webhooks/sentry`

See [GENERIC_ARCHITECTURE.md](./GENERIC_ARCHITECTURE.md) for detailed examples.

## 📊 Status & Monitoring

- **Dashboard**: http://localhost:3000/dashboard
- **Portainer**: Configure in docker-compose (port 9443)
- **Dozzle**: Configure in docker-compose (port 8080)

## 🔧 Configuration

### Project Registry

Edit `router/src/config/projects.ts` to add repositories:

```typescript
export const projects: ProjectConfig[] = [
  {
    id: 'my-app',
    repo: 'git@github.com:owner/my-app.git',
    repoFullName: 'owner/my-app',
    branch: 'main',
    triggers: {
      sentry: { projectSlug: 'my-app-prod', enabled: true },
      github: { issues: true, labels: ['bug'] }
    }
  }
];
```

### Environment Variables

Required in `.env`:

```bash
# GitHub
GITHUB_TOKEN=ghp_xxx
GITHUB_WEBHOOK_SECRET=xxx

# Source-specific tokens
SENTRY_AUTH_TOKEN=xxx
SENTRY_ORG=xxx
CIRCLECI_TOKEN=xxx

# System
USER=yourusername
NODE_ENV=production
```

## 🧪 Development

```bash
cd router

# Install dependencies
npm install

# Run in development mode
npm run dev

# Build
npm run build

# Run production build
npm start
```

## 📝 Current Status

### ✅ Completed

- Base project structure
- TypeScript configuration
- Docker setup (router + claude-runner)
- Generic source plugin architecture
- Webhook routing system
- Basic status dashboard
- Environment configuration

### 🚧 TODO

- [ ] Implement source plugins (Sentry, GitHub, CircleCI)
- [ ] BullMQ job queue setup
- [ ] Claude container orchestration
- [ ] Dynamic tool generation
- [ ] Generic prompt builder
- [ ] Fix orchestration logic
- [ ] GitHub PR creation
- [ ] Auth health monitoring
- [ ] Cloudflare tunnel setup

## 📚 Documentation

- [Generic Architecture Design](./GENERIC_ARCHITECTURE.md) - Detailed plugin architecture
- [Original Implementation Plan](./claude-agent-implementation-plan.md) - Initial design

## 🤝 Contributing

This is a self-hosted automation system. To extend:

1. Add new source plugins in `router/src/sources/`
2. Implement the `SourcePlugin` interface
3. Register in the sources index
4. Configure webhooks to point to your endpoint

## 📄 License

MIT
