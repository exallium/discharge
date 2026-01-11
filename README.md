# AI Bug Fixer

A self-hosted automation system that uses AI agents to automatically investigate and fix bugs from various sources (GitHub Issues, Sentry, CircleCI, etc.).

## 🌟 Features

- **Automated Bug Detection** - Receive webhooks from GitHub Issues, Sentry, CircleCI, and more
- **AI-Powered Investigation** - Uses AI agents (Claude Code CLI by default) to analyze and fix bugs
- **Pull Request Creation** - Automatically creates PRs with fixes and detailed analysis
- **Plugin Architecture** - Extensible trigger and runner plugin systems
- **Production Ready** - Health checks, structured logging, rate limiting, environment validation
- **Home-Friendly** - Deploy on a Mac Mini or home server with Cloudflare Tunnel
- **Multiple Deployment Options** - Docker Compose, Coolify, Kubernetes

## 🏗️ Architecture

**Plugin-based architecture** with three main plugin types:

- **Trigger Plugins** - Handle webhooks from bug sources (GitHub Issues, Sentry, CircleCI)
- **Runner Plugins** - Execute AI agents (Claude Code, or custom LLMs)
- **VCS Plugins** - Interact with version control systems (GitHub, GitLab, Bitbucket)

**Core Components:**

- **Router** - Express.js webhook receiver, job queue orchestrator, worker manager
- **Redis** - BullMQ job queue backend
- **Runner Containers** - Dynamically spawned Docker containers that execute AI agents
- **External Services** - GitHub, Sentry, CircleCI (webhooks), Anthropic API (Claude)

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed component breakdown, data flow, and deployment architecture.

## 📁 Project Structure

```
ai-bug-fixer/
├── router/                          # Main application
│   ├── src/
│   │   ├── index.ts                 # Express app entry
│   │   ├── config/                  # Project configurations
│   │   ├── triggers/                # Trigger plugins (GitHub, Sentry, CircleCI)
│   │   │   ├── github-issues/
│   │   │   ├── sentry/
│   │   │   ├── circleci/
│   │   │   └── base.ts
│   │   ├── runner/                  # AI agent orchestration
│   │   │   ├── runners/             # Runner plugins (Claude Code, custom)
│   │   │   ├── orchestrator.ts
│   │   │   └── prompts.ts
│   │   ├── vcs/                     # VCS plugins (GitHub, GitLab)
│   │   │   ├── github/
│   │   │   └── base.ts
│   │   ├── webhooks/                # Webhook routing
│   │   ├── queue/                   # BullMQ job queue
│   │   ├── health.ts                # Health check endpoints
│   │   ├── logger.ts                # Structured logging
│   │   ├── rate-limiter.ts          # Rate limiting middleware
│   │   └── env-validator.ts         # Environment validation
│   ├── tests/                       # Comprehensive test suite
│   │   ├── unit/                    # Unit tests (no dependencies)
│   │   ├── integration/             # Integration tests (Docker required)
│   │   ├── fixtures/                # Test data and payloads
│   │   └── helpers/                 # Test utilities
│   ├── Dockerfile                   # Multi-stage production build
│   └── package.json
│
├── claude-runner/                   # Default AI agent container
│   └── Dockerfile                   # Claude Code CLI runner
│
├── .env.example                     # Environment template (comprehensive)
├── setup.sh                         # Automated setup script
├── docker-compose.yml               # Development configuration
├── docker-compose.prod.yml          # Production configuration
│
└── docs/
    ├── ARCHITECTURE.md              # System architecture and deployment
    ├── DEPLOYMENT.md                # Production deployment guide
    ├── EXPOSING-WEBHOOKS.md         # Webhook exposure (Cloudflare Tunnel, etc.)
    ├── AGENTS.md                    # Plugin development guide
    └── GENERIC_ARCHITECTURE.md      # Original design document
```

## 🚀 Quick Start

### Option 1: Automated Setup (Recommended)

```bash
# Clone repository
git clone https://github.com/yourusername/ai-bug-fixer.git
cd ai-bug-fixer

# Run automated setup
bash setup.sh

# Follow prompts to configure:
# - Environment variables
# - GitHub tokens
# - Docker network
# - Claude CLI authentication

# Start services
docker-compose -f docker-compose.prod.yml up -d

# Verify deployment
curl http://localhost:3000/health
```

### Option 2: Manual Setup

#### Prerequisites

- **Docker** 20.10+ and Docker Compose 2.0+
- **Node.js** 20+ (for local development)
- **Claude Code CLI** installed and authenticated (`claude auth`)
- **Git** 2.0+

#### 1. Clone and Configure

```bash
git clone https://github.com/yourusername/ai-bug-fixer.git
cd ai-bug-fixer

# Copy environment template
cp .env.example .env

# Edit with your credentials
nano .env
```

**Environment variables:**

```bash
# Core (required)
REDIS_URL=redis://localhost:6379        # Job queue backend
USER=yourusername                       # Your macOS/Linux username
NODE_ENV=production

# Per-plugin (required only if using that plugin)
GITHUB_TOKEN=ghp_xxx                    # GitHub VCS/trigger
GITHUB_WEBHOOK_SECRET=xxx               # GitHub webhook validation
SENTRY_AUTH_TOKEN=xxx                   # Sentry trigger
SENTRY_ORG=your-org
CIRCLECI_TOKEN=xxx                      # CircleCI trigger
# Claude Code runner uses local OAuth (claude auth) - no API key needed
```

See `.env.example` for all available configuration options.

#### 2. Configure Projects

Edit `router/src/config/projects.ts`:

```typescript
export const projects: ProjectConfig[] = [
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
        allowedUsers: ['maintainer1', 'maintainer2'],
      },
      sentry: {
        projectSlug: 'my-app-prod',
        enabled: true,
      },
    },
  },
];
```

#### 3. Build and Start

```bash
# Build Docker images
docker-compose -f docker-compose.prod.yml build

# Start services
docker-compose -f docker-compose.prod.yml up -d

# View logs
docker-compose -f docker-compose.prod.yml logs -f router
```

#### 4. Verify Deployment

```bash
# Health check (comprehensive system status)
curl http://localhost:3000/health | jq

# Readiness probe
curl http://localhost:3000/ready

# Dashboard (browser)
open http://localhost:3000/dashboard

# List webhook endpoints
curl http://localhost:3000/webhooks | jq
```

## 🌐 Exposing to External Services

For home deployments (Mac Mini, Raspberry Pi, etc.), you need to expose webhooks to GitHub, Sentry, CircleCI.

### Cloudflare Tunnel (Recommended - Free)

```bash
# Install
brew install cloudflared

# Authenticate
cloudflared tunnel login

# Create tunnel
cloudflared tunnel create ai-bug-fixer

# Configure (~/.cloudflared/config.yml)
tunnel: <TUNNEL-ID>
credentials-file: ~/.cloudflared/<TUNNEL-ID>.json

ingress:
  - hostname: ai-bug-fixer.yourdomain.com
    service: http://localhost:3000
  - service: http_status:404

# Route DNS
cloudflared tunnel route dns ai-bug-fixer ai-bug-fixer.yourdomain.com

# Run
cloudflared tunnel run ai-bug-fixer
```

**Benefits:**
- ✅ Free unlimited bandwidth
- ✅ Automatic HTTPS
- ✅ No router configuration
- ✅ Works through NAT/firewall

**Full guide:** See [EXPOSING-WEBHOOKS.md](./EXPOSING-WEBHOOKS.md) for Mac Mini setup, LaunchAgent configuration, alternatives (ngrok, etc.), and troubleshooting.

### Configure Webhooks

Once exposed, configure your services:

**GitHub Issues:**
- URL: `https://ai-bug-fixer.yourdomain.com/webhooks/github-issues`
- Content type: `application/json`
- Secret: Your `GITHUB_WEBHOOK_SECRET`
- Events: `Issues`, `Issue comments`

**Sentry:**
- URL: `https://ai-bug-fixer.yourdomain.com/webhooks/sentry`
- Events: Issue created

**CircleCI:**
- URL: `https://ai-bug-fixer.yourdomain.com/webhooks/circleci`
- Events: Workflow completed

## 🎯 Repository Configuration

Customize how AI Bug Fixer handles bugs in your repository by adding a `.ai-bugs.json` file to your repo root.

### Why Use `.ai-bugs.json`?

- **Different bug types need different approaches** - UI bugs need visual testing, database bugs need migration safety checks
- **Per-category infrastructure** - Only spin up Supabase/Postgres when the bug actually needs it
- **Project-specific test commands** - Tell Claude exactly how to verify fixes in your project

### Quick Start

Copy the sample config to your repository:

```bash
cp .ai-bugs.json.sample /path/to/your/repo/.ai-bugs.json
```

### Example Configuration

```json
{
  "version": "1",
  "categories": {
    "utility": {
      "match": { "labels": ["utility", "helper"] },
      "requirements": ["Run unit tests"],
      "deliverables": ["unit tests pass"],
      "testCommand": "npm test"
    },
    "database": {
      "match": { "labels": ["database", "postgres"] },
      "infrastructure": {
        "setup": "supabase start",
        "teardown": "supabase stop"
      },
      "requirements": ["Verify migration safety", "Check query performance"],
      "deliverables": ["migration up/down works"],
      "testCommand": "npm run test:db"
    },
    "default": {
      "requirements": ["Run unit tests"],
      "deliverables": ["unit tests pass"],
      "testCommand": "npm test"
    }
  }
}
```

### How It Works

1. When a bug is triggered (e.g., GitHub issue with label `database`), the runner clones your repo
2. It reads `.ai-bugs.json` and matches the issue labels to a category
3. If the category has `infrastructure`, it runs the setup command before Claude starts
4. Claude receives the category-specific requirements and test command in its prompt
5. After Claude finishes, infrastructure is torn down automatically

See [AGENTS.md](./AGENTS.md) for the full schema reference.

## 🔌 Plugin Development

The system is designed for extensibility. Create custom plugins for new bug sources or AI agents.

### Creating a Trigger Plugin

Integrate new bug sources (Linear, Jira, Datadog, etc.):

```typescript
// router/src/triggers/my-trigger/index.ts
import { TriggerPlugin, TriggerEvent, Tool } from '../base';

export class MyTrigger implements TriggerPlugin {
  id = 'my-trigger';
  type = 'my-trigger';

  async validateWebhook(req: Request): Promise<boolean> {
    // Verify webhook signature
  }

  async parseWebhook(payload: any): Promise<TriggerEvent | null> {
    // Parse webhook into normalized event
  }

  getTools(event: TriggerEvent): Tool[] {
    // Return investigation tools for AI agent
  }

  async updateStatus(event: TriggerEvent, status: FixStatus): Promise<void> {
    // Update source system with fix status
  }

  // ... other required methods
}
```

**Complete guide:** See [AGENTS.md](./AGENTS.md) for:
- Full TriggerPlugin interface documentation
- Working examples (Sentry, GitHub Issues, CircleCI)
- Testing guidelines
- Best practices

### Creating a Runner Plugin

Integrate different AI agents (OpenAI, Anthropic direct API, custom LLMs):

```typescript
// router/src/runner/runners/my-runner/index.ts
import { RunnerPlugin, RunContext, RunResult } from '../../base';

export class MyRunner implements RunnerPlugin {
  id = 'my-runner';
  name = 'My Custom AI Runner';

  async execute(context: RunContext): Promise<RunResult> {
    // Execute your AI agent
    // Return results
  }

  async isAvailable(): Promise<boolean> {
    // Check if runner can execute
  }
}
```

### Creating a VCS Plugin

Add support for GitLab, Bitbucket, or self-hosted Git:

```typescript
// router/src/vcs/gitlab/index.ts
import { VCSPlugin, PullRequest } from '../base';

export class GitLabVCS implements VCSPlugin {
  id = 'gitlab';
  type = 'gitlab';

  async createPullRequest(...): Promise<PullRequest> {
    // Create merge request in GitLab
  }

  // ... other required methods
}
```

## 🧪 Testing

Comprehensive test suite with 130+ tests covering all components.

```bash
cd router

# Run unit tests (default - no dependencies)
npm test

# Run integration tests (requires Docker)
npm run test:integration

# Run all tests (unit + integration)
npm run test:all

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage
```

### Test Organization

- **Unit tests** (`tests/unit/`) - Mock all external dependencies (Redis, Docker, APIs)
- **Integration tests** (`tests/integration/`) - Use real infrastructure via Docker Compose
- **Fixtures** (`tests/fixtures/`) - Realistic webhook payloads for all triggers
- **Helpers** (`tests/helpers/`) - Test utilities and setup functions

See [router/tests/README.md](./router/tests/README.md) for testing documentation.

## 📊 Monitoring & Operations

### Health Checks

Three health check endpoints for different purposes:

- **`/health`** - Comprehensive system health (Redis, queue, triggers, VCS, runners)
- **`/ready`** - Readiness probe for load balancers (is system ready to handle requests?)
- **`/live`** - Liveness probe for orchestrators (is process alive?)

```bash
# Check system health
curl http://localhost:3000/health | jq

# Example response
{
  "status": "healthy",
  "timestamp": "2024-01-10T12:00:00.000Z",
  "uptime": 3600,
  "version": "1.0.0",
  "checks": {
    "redis": { "status": "pass", "latency": "2ms" },
    "queue": { "status": "pass", "stats": {...} },
    "triggers": { "status": "pass", "count": 3 },
    "vcs": { "status": "pass", "count": 1 },
    "runners": { "status": "pass", "count": 1 }
  }
}
```

### Dashboard

Visual status dashboard at `http://localhost:3000/dashboard`:
- Real-time system status
- Queue statistics (waiting, active, completed, failed jobs)
- Registered triggers
- Auto-refreshes every 30 seconds

### Structured Logging

JSON-formatted logs with configurable levels:

```bash
# Configure in .env
LOG_LEVEL=info          # error | warn | info | debug
LOG_FORMAT=json         # json | pretty
LOG_REQUESTS=true       # Log HTTP requests

# View logs
docker-compose -f docker-compose.prod.yml logs -f router

# Example log entry
{
  "timestamp": "2024-01-10T12:00:00.000Z",
  "level": "info",
  "message": "AI Bug Fixer Router started",
  "service": "ai-bug-fixer-router",
  "port": 3000,
  "nodeEnv": "production"
}
```

### Rate Limiting

Built-in rate limiting to prevent abuse:

```bash
# Configure in .env
RATE_LIMIT_WEBHOOK=60   # Webhooks per minute per IP
RATE_LIMIT_API=100      # API requests per minute per IP

# Responses include rate limit headers
RateLimit-Limit: 60
RateLimit-Remaining: 45
RateLimit-Reset: 1704895260
```

## 🚀 Deployment

### Docker Compose (Simple)

For single-server deployments:

```bash
docker-compose -f docker-compose.prod.yml up -d
```

### Coolify (Recommended for Home Server)

Perfect for Mac Mini or home server deployments:

1. Install Coolify on your server
2. Create new Service → Docker Compose
3. Point to `docker-compose.prod.yml`
4. Configure environment variables in Coolify UI
5. Deploy

**Benefits:**
- One-click deployment
- Automatic HTTPS
- Built-in monitoring
- Easy rollback
- Volume management

### Kubernetes

For production scale:

```bash
# Create secrets
kubectl create secret generic github-secrets --from-env-file=.env

# Deploy
kubectl apply -f k8s/

# Check status
kubectl get pods
kubectl logs -f deployment/ai-bug-fixer-router
```

See [DEPLOYMENT.md](./DEPLOYMENT.md) for:
- Complete deployment guide for all platforms
- Kubernetes manifests
- Security checklist
- Monitoring setup
- Backup strategies
- Troubleshooting

## 📈 System Requirements

### Minimum (Development)

- **CPU**: 2 cores
- **RAM**: 4GB
- **Disk**: 20GB SSD
- **Handles**: ~10 jobs/hour, 1 concurrent job

### Recommended (Production)

- **CPU**: 4 cores
- **RAM**: 8GB
- **Disk**: 50GB SSD
- **Handles**: ~100 jobs/hour, 2-4 concurrent jobs

### High Volume

- **CPU**: 8+ cores
- **RAM**: 16GB+
- **Disk**: 100GB+ SSD
- **Handles**: Unlimited jobs/hour, 8+ concurrent jobs

## 💰 Cost Estimate

**Home deployment on Mac Mini with Cloudflare Tunnel:**

```
Hardware:           $0 (you own it)
Docker:             $0 (free)
AI Bug Fixer:       $0 (open source)
Cloudflare Tunnel:  $0 (free tier)
Domain name:        ~$10/year (~$1/month)
──────────────────────────────────────
Monthly:            ~$1 + Anthropic API usage
```

**Cloud deployment (VPS + managed Redis):**

```
VPS (4 cores, 8GB): $20-40/month
Managed Redis:      $10-20/month (optional)
Cloudflare Tunnel:  $0
Domain:             $1/month
──────────────────────────────────────
Monthly:            ~$30-60 + API usage
```

## 🔐 Security

### Built-in Security Features

- ✅ Webhook signature validation (GitHub, CircleCI)
- ✅ Rate limiting on all endpoints
- ✅ Environment variable validation on startup
- ✅ Non-root Docker containers
- ✅ Read-only volume mounts where possible
- ✅ Docker socket access restricted
- ✅ Secrets never logged

### Security Checklist

- [ ] All secrets in `.env` (never in code)
- [ ] `.env` added to `.gitignore`
- [ ] Webhook secrets generated with strong randomness
- [ ] Tokens have minimum required permissions
- [ ] HTTPS enabled (via Cloudflare Tunnel or reverse proxy)
- [ ] Rate limiting configured
- [ ] Firewall rules allow only necessary ports
- [ ] Docker images scanned for vulnerabilities

See [DEPLOYMENT.md - Security Checklist](./DEPLOYMENT.md#security-checklist) for complete security guide.

## 📚 Documentation

- **[ARCHITECTURE.md](./ARCHITECTURE.md)** - System architecture, components, data flow, deployment options
- **[DEPLOYMENT.md](./DEPLOYMENT.md)** - Production deployment, security, monitoring, scaling
- **[EXPOSING-WEBHOOKS.md](./EXPOSING-WEBHOOKS.md)** - Cloudflare Tunnel setup, Mac Mini configuration, alternatives
- **[AGENTS.md](./AGENTS.md)** - Plugin development guide (triggers, runners, VCS)
- **[router/tests/README.md](./router/tests/README.md)** - Testing guide and best practices

## 🎯 Current Status

### ✅ Production Ready

**Core System:**
- ✅ Plugin-based architecture (triggers, runners, VCS)
- ✅ Express.js router with webhook handling
- ✅ BullMQ job queue with Redis backend
- ✅ Worker pool for concurrent job processing
- ✅ Docker container orchestration

**Production Features:**
- ✅ Health checks (`/health`, `/ready`, `/live`)
- ✅ Structured logging (Winston, JSON/pretty formats)
- ✅ Rate limiting (configurable per endpoint type)
- ✅ Environment validation on startup
- ✅ Graceful shutdown handling
- ✅ Multi-stage Docker builds (optimized images)
- ✅ Production docker-compose configuration

**Triggers:**
- ✅ GitHub Issues (with label filtering, comment triggers, user allowlists)
- ✅ Sentry (error monitoring integration)
- ✅ CircleCI (build failure detection)

**Runners:**
- ✅ Claude Code (default AI agent)
- ✅ Pluggable runner architecture (add custom AI agents)

**VCS:**
- ✅ GitHub (PR creation, comments, status updates)
- ✅ Pluggable VCS architecture (add GitLab, Bitbucket, etc.)

**Testing:**
- ✅ 130+ tests (unit + integration)
- ✅ Mock trigger plugin for testing
- ✅ Webhook payload fixtures
- ✅ Docker Compose test environment

**Documentation:**
- ✅ Architecture guide
- ✅ Deployment guide
- ✅ Webhook exposure guide (Mac Mini focus)
- ✅ Plugin development guide
- ✅ Automated setup script

### 🚀 Ready for Use

The system is **production-ready** and can be deployed today for:
- Automated bug fixing from GitHub Issues
- Error monitoring and fixing from Sentry
- Test failure investigation from CircleCI
- Custom triggers via plugin development

## 📄 License

MIT License - See LICENSE file for details

---

**Questions?** Check the documentation:
- [Architecture](./ARCHITECTURE.md) - How it works
- [Deployment](./DEPLOYMENT.md) - How to deploy
- [Webhooks](./EXPOSING-WEBHOOKS.md) - How to expose (especially for home servers)
- [Plugins](./AGENTS.md) - How to extend
