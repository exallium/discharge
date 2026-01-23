# Discharge Architecture

This document explains the system architecture, what runs where, and deployment options including Coolify.

## System Components

### Components Running in Docker

#### 1. **Web App** (Next.js Application)
- **Image**: Built from `router/Dockerfile`
- **Purpose**: Web UI, API routes for webhooks, admin dashboard
- **Ports**: 3000 (HTTP)
- **Dependencies**:
  - PostgreSQL (required)
  - Redis (required)

**What it does:**
- Serves admin UI for managing projects and secrets
- Receives webhooks from GitHub, Sentry, CircleCI via API routes
- Validates webhook signatures
- Parses events and queues jobs

#### 2. **Worker** (Background Job Processor)
- **Image**: Same as web app, different entrypoint
- **Purpose**: Process queued jobs, spawn runner containers
- **Dependencies**:
  - PostgreSQL (required)
  - Redis (required)
  - Docker socket (required - for spawning runner containers)
  - Claude CLI credentials (volume mount)

**What it does:**
- Picks up jobs from BullMQ queue
- Spawns dynamic runner containers for each job
- Monitors job completion
- Posts status updates back to triggers

#### 3. **PostgreSQL** (Database)
- **Image**: `postgres:15-alpine` (official)
- **Purpose**: Persistent storage for projects, jobs, encrypted secrets
- **Ports**: 5432 (internal only)
- **Persistence**: Volume `postgres_data`

**What it does:**
- Stores project configurations
- Stores encrypted service credentials
- Stores job history and audit logs

#### 4. **Redis** (Job Queue Backend)
- **Image**: `redis:7-alpine` (official)
- **Purpose**: BullMQ job queue, worker coordination
- **Ports**: 6379 (internal only)
- **Persistence**: Volume `redis_data`

**What it does:**
- Stores job queue (waiting, active, completed, failed jobs)
- Coordinates between web app and workers
- Ephemeral queue state

#### 5. **Runner Containers** (Dynamically Spawned)
- **Image**: Built from `agent-runners/claude-code/Dockerfile`
- **Purpose**: Execute AI agent (Claude Code CLI) to investigate and fix bugs
- **Lifecycle**: Created per job, destroyed after completion
- **Network**: Shares `discharge_internal` network with router

**What it does:**
- Clones repository
- Creates fix branch
- Runs Claude Code CLI with investigation tools
- Commits changes
- Pushes branch

### External Services (Not in Docker)

#### 1. **GitHub**
- **Type**: External SaaS
- **Used for**:
  - VCS (clone, push, create PRs)
  - Webhooks (issues, comments)
  - API (posting comments, creating PRs)

#### 2. **Sentry** (Optional)
- **Type**: External SaaS
- **Used for**:
  - Error monitoring webhooks
  - Fetching stack traces and error context

#### 3. **CircleCI** (Optional)
- **Type**: External SaaS
- **Used for**:
  - Build failure webhooks
  - Fetching test results and logs

#### 4. **Anthropic API**
- **Type**: External SaaS
- **Used for**:
  - Claude Code CLI authentication
  - AI model API calls (via Claude CLI)

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         External Services                        │
├─────────────────────────────────────────────────────────────────┤
│  GitHub  │  Sentry  │  CircleCI  │  Anthropic API              │
└────┬───────────┬────────────┬────────────────┬─────────────────┘
     │           │            │                │
     │ Webhooks  │            │                │ API Calls
     │           │            │                │
     ▼           ▼            ▼                ▼
┌────────────────────────────────────────────────────────────────┐
│                      Docker Host                                │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │  Docker Network: discharge_internal                  │  │
│  │                                                          │  │
│  │  ┌──────────────┐         ┌──────────────┐             │  │
│  │  │   Web App    │◄───────►│  PostgreSQL  │             │  │
│  │  │  (Next.js)   │         │              │             │  │
│  │  │              │         │ - Projects   │             │  │
│  │  │ - API Routes │         │ - Secrets    │             │  │
│  │  │ - Admin UI   │         │ - Job logs   │             │  │
│  │  │ - Webhooks   │         └──────────────┘             │  │
│  │  └──────────────┘                                       │  │
│  │                                                          │  │
│  │  ┌──────────────┐         ┌──────────────┐             │  │
│  │  │    Worker    │◄───────►│    Redis     │             │  │
│  │  │              │         │              │             │  │
│  │  │ - Job queue  │         │ - BullMQ     │             │  │
│  │  │ - Spawn runs │         │ - Queue      │             │  │
│  │  └──────┬───────┘         └──────────────┘             │  │
│  │         │                                               │  │
│  │         │ Spawns dynamically                            │  │
│  │         ▼                                               │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │  │
│  │  │   Runner 1   │  │   Runner 2   │  │   Runner N   │ │  │
│  │  │              │  │              │  │              │ │  │
│  │  │ Claude Code  │  │ Claude Code  │  │ Claude Code  │ │  │
│  │  │ CLI          │  │ CLI          │  │ CLI          │ │  │
│  │  └──────────────┘  └──────────────┘  └──────────────┘ │  │
│  │                                                          │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                                 │
│  Volume Mounts:                                                │
│  - ~/.claude → Runner containers (Claude CLI credentials)     │
│  - /workspaces → Temporary git clones                         │
│  - /var/run/docker.sock → Worker (spawn runners)              │
│                                                                 │
└────────────────────────────────────────────────────────────────┘
```

## Data Flow

### 1. Webhook Event (e.g., GitHub Issue)

```
GitHub → POST /api/webhooks/github
         ↓
Web App validates webhook signature
         ↓
Web App parses event → TriggerEvent
         ↓
Web App queues job → Redis (BullMQ)
         ↓
Worker picks up job from queue
         ↓
Worker loads project config from PostgreSQL
         ↓
Worker spawns Runner container
         ↓
Runner clones repository
         ↓
Runner runs Claude Code CLI
         ↓
Claude investigates with tools
         ↓
Claude creates fix + commits
         ↓
Runner pushes branch
         ↓
Worker creates PR via GitHub API
         ↓
Worker posts comment on issue
         ↓
Runner container destroyed
```

## Deployment Options

### Option 1: Docker Compose (Recommended for Simple Deployments)

**What you need:**
- Server with Docker + Docker Compose
- Public IP or tunnel (for webhooks)
- ~4GB RAM minimum

**Files:**
- `docker-compose.prod.yml` - Production configuration

**Commands:**
```bash
# Start services
docker-compose -f docker-compose.prod.yml up -d

# View logs
docker-compose -f docker-compose.prod.yml logs -f

# Stop services
docker-compose -f docker-compose.prod.yml down
```

**Components:**
- ✅ Web App (always running)
- ✅ Worker (always running)
- ✅ PostgreSQL (always running)
- ✅ Redis (always running)
- ✅ Runners (spawned dynamically)

### Option 2: Coolify (Recommended for Easy Management)

**Coolify compatibility: YES ✅**

Coolify is perfect for this project! Here's how to deploy:

#### Coolify Setup

1. **Create a new Service** (not Application)
   - Type: Docker Compose
   - Source: Git repository

2. **Use the production compose file:**
   ```yaml
   # In Coolify, point to docker-compose.prod.yml
   # Or paste the contents directly
   ```

3. **Configure environment variables in Coolify UI:**
   - `GITHUB_TOKEN`
   - `GITHUB_WEBHOOK_SECRET`
   - `REDIS_URL` (use internal: `redis://redis:6379`)
   - `PORT` (default: 3000)
   - `WORKER_CONCURRENCY` (default: 2)
   - Plus any optional service tokens (Sentry, CircleCI)

4. **Set up persistent volumes:**
   - Redis data: `/data` → Named volume
   - Workspaces: `/workspaces` → Named volume
   - Claude credentials: `~/.claude` → Host path (read-only)
   - Docker socket: `/var/run/docker.sock` → Host path

5. **Configure networking:**
   - Coolify will handle the internal network
   - Expose port 3000 for webhooks
   - Optional: Use Cloudflare tunnel (Coolify supports this)

6. **Health checks:**
   - Path: `/health`
   - Port: 3000
   - Interval: 30s

#### Coolify-Specific Configuration

Create `coolify.yml` in repo root:

```yaml
services:
  discharge:
    build:
      context: ./router
      dockerfile: Dockerfile
    environment:
      NODE_ENV: production
      # Coolify will inject secrets
    volumes:
      - redis_data:/data
      - workspaces:/workspaces
      - ~/.claude:/home/appuser/.claude:ro
      - /var/run/docker.sock:/var/run/docker.sock
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://localhost:3000/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); })"]
      interval: 30s
      timeout: 5s
      retries: 3
```

#### Benefits of Coolify:

- **Easy deployment**: Git push → auto-deploy
- **Built-in monitoring**: Dashboard for logs, metrics
- **Automatic HTTPS**: Via Caddy or Cloudflare
- **Secret management**: Secure environment variable storage
- **Backup support**: Volume snapshots
- **One-click rollback**: Revert to previous versions
- **Multi-server**: Can run on multiple nodes

### Option 3: Kubernetes

**For production scale deployments.**

See `DEPLOYMENT.md` for Kubernetes manifests.

**Components:**
- Deployment: Router (3+ replicas)
- StatefulSet: Redis (or use managed Redis)
- Jobs: Runners (CronJob or Job objects)
- Service: LoadBalancer for webhooks
- Ingress: HTTPS with cert-manager

### Option 4: Manual Installation (Not Recommended)

**Requirements:**
- Node.js 20+
- Redis server
- Docker (for runners)

**Not recommended because:**
- No automatic restart on crashes
- Manual process management
- Complex systemd setup
- No log aggregation
- Difficult to scale

## Resource Requirements

### Minimum (Development)

- **CPU**: 2 cores
- **RAM**: 4GB
- **Disk**: 20GB SSD
- **Network**: 10 Mbps

**Can handle:**
- ~10 jobs/hour
- 1 concurrent job
- Small repositories (<100MB)

### Recommended (Production)

- **CPU**: 4 cores
- **RAM**: 8GB
- **Disk**: 50GB SSD
- **Network**: 100 Mbps

**Can handle:**
- ~100 jobs/hour
- 2-4 concurrent jobs
- Medium repositories (<500MB)

### High Volume

- **CPU**: 8+ cores
- **RAM**: 16GB+
- **Disk**: 100GB+ SSD
- **Network**: 1 Gbps

**Can handle:**
- Unlimited jobs/hour
- 8+ concurrent jobs
- Large repositories (<2GB)

## Scaling Strategies

### Vertical Scaling (Single Server)

Increase resources for router:

```yaml
# docker-compose.prod.yml
services:
  router:
    deploy:
      resources:
        limits:
          cpus: '8'
          memory: 16G
        reservations:
          cpus: '4'
          memory: 8G
```

Increase worker concurrency:

```bash
WORKER_CONCURRENCY=8
```

### Horizontal Scaling (Multiple Servers)

**Option A: Multiple Router Instances**

- Use shared Redis (managed service)
- Deploy router to multiple servers
- Load balancer in front
- Same Docker network name on all hosts

**Option B: Kubernetes**

- Auto-scaling based on queue depth
- Horizontal Pod Autoscaler (HPA)
- Multiple router replicas
- Dynamic runner Job scheduling

### Managed Services

**Use external managed services to reduce operational load:**

1. **Redis Cloud** - Replaces local Redis
   - High availability
   - Automatic backups
   - No maintenance

2. **Railway / Render** - Alternative to Coolify
   - Managed container hosting
   - Auto-scaling
   - Built-in monitoring

3. **AWS ECS / Google Cloud Run**
   - Enterprise-grade scaling
   - Pay-per-use
   - Integrated monitoring

## Security Considerations

### Docker Socket Access

The router needs Docker socket access to spawn runners. This is a security risk if the router is compromised.

**Mitigations:**
1. Run router as non-root user (✅ already configured)
2. Use AppArmor/SELinux profiles
3. Consider **Docker-in-Docker** instead of socket mounting
4. Use **Kubernetes** with Pod Security Standards

### Network Isolation

All containers run in isolated network `discharge_internal`:

- External access only via router port 3000
- Redis not exposed to internet
- Runners can't access each other
- No ingress from outside network

### Secrets Management

**Development:**
- `.env` file (git-ignored)

**Production with Coolify:**
- Coolify secret store
- Environment variables injected at runtime
- Rotation support

**Production with Kubernetes:**
- Kubernetes Secrets
- External Secrets Operator
- Vault integration

## Monitoring & Observability

### Built-in Endpoints

- **`/health`** - Comprehensive health check
- **`/ready`** - Readiness probe (for load balancers)
- **`/live`** - Liveness probe (for orchestrators)
- **`/dashboard`** - HTML status dashboard

### Coolify Integration

Coolify automatically monitors:
- Container health (via health checks)
- CPU/Memory usage
- Logs (searchable)
- Network traffic

### Production Monitoring Stack

For large deployments, add:

1. **Prometheus** - Metrics collection
2. **Grafana** - Dashboards and alerting
3. **Loki** - Log aggregation
4. **Jaeger** - Distributed tracing

Example docker-compose addition:

```yaml
services:
  prometheus:
    image: prom/prometheus:latest
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
    ports:
      - "9090:9090"

  grafana:
    image: grafana/grafana:latest
    ports:
      - "3001:3000"
```

## Storage

### Persistent Volumes

1. **`postgres_data`**
   - Purpose: Database storage (projects, secrets, job logs)
   - Size: ~1-5GB (grows with job history)
   - Backup: Yes (critical)

2. **`redis_data`**
   - Purpose: Job queue state
   - Size: ~100MB (queue is ephemeral)
   - Backup: Optional (can rebuild from postgres)

3. **`workspaces`**
   - Purpose: Temporary git clones
   - Size: Varies (cleaned up after jobs)
   - Backup: No (ephemeral)

### Backup Strategy

**PostgreSQL data** (critical):
```bash
# Manual backup
docker-compose exec postgres pg_dump -U postgres ai_bug_fixer > ./backups/db.sql

# Automated (cron)
0 2 * * * /path/to/backup-postgres.sh
```

**Configuration**:
```bash
# Backup .env file
cp .env ./backups/.env.$(date +%Y%m%d)
```

## Troubleshooting

### Check Component Status

```bash
# All containers
docker-compose -f docker-compose.prod.yml ps

# Logs
docker-compose -f docker-compose.prod.yml logs -f router

# Health check
curl http://localhost:3000/health | jq

# Queue stats
curl http://localhost:3000/dashboard
```

### Common Issues

**Redis connection failed:**
```bash
# Check Redis
docker-compose exec redis redis-cli ping

# Check network
docker network inspect discharge_internal
```

**Runner spawn failed:**
```bash
# Check Docker socket
docker info

# Check network exists
docker network ls | grep discharge
```

**Out of disk space:**
```bash
# Clean up old workspaces
docker system prune -a --volumes

# Check disk usage
df -h
docker system df
```

## Development vs Production

### Development Setup

```bash
# Use docker-compose.yml (not .prod.yml)
docker-compose up -d

# Or run router locally
cd router
npm install
npm run dev
```

### Production Setup

```bash
# Use production configuration
docker-compose -f docker-compose.prod.yml up -d

# Or deploy to Coolify
git push coolify main
```

## Cost Estimation

### Self-hosted (Coolify/VPS)

- **VPS**: $20-50/month (Hetzner, DigitalOcean)
- **Anthropic API**: Variable ($10-100/month depending on usage)
- **Total**: ~$30-150/month

### Managed Services

- **Railway/Render**: $30-100/month
- **Anthropic API**: $10-100/month
- **Total**: ~$40-200/month

### Enterprise (Kubernetes)

- **Cloud hosting**: $200-1000/month
- **Managed Redis**: $50-200/month
- **Anthropic API**: $100-1000/month
- **Total**: ~$350-2200/month

## Recommended Setup for Most Users

**Coolify on a $20/month VPS:**

1. Install Coolify on Hetzner/DigitalOcean
2. Deploy Discharge via git
3. Use Cloudflare tunnel for webhooks
4. Let Coolify handle monitoring, backups, HTTPS
5. Pay only for Anthropic API usage

**Benefits:**
- ✅ One-click deployment
- ✅ Automatic HTTPS
- ✅ Built-in monitoring
- ✅ Easy scaling
- ✅ Cost-effective

**Total setup time: ~30 minutes**
