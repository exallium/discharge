# Production Deployment Guide

This guide covers deploying the AI Bug Fixer to production with best practices for security, reliability, and monitoring.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Exposing to External Services](#exposing-to-external-services)
- [Environment Setup](#environment-setup)
- [Docker Deployment](#docker-deployment)
- [Kubernetes Deployment](#kubernetes-deployment)
- [Monitoring and Logging](#monitoring-and-logging)
- [Security Checklist](#security-checklist)
- [Troubleshooting](#troubleshooting)
- [Scaling](#scaling)

## Prerequisites

### System Requirements

- **Operating System**: Linux (Ubuntu 20.04+ recommended) or macOS
- **CPU**: 2+ cores recommended (4+ for high traffic)
- **RAM**: 4GB minimum (8GB+ recommended)
- **Disk**: 20GB minimum (SSD recommended for Redis)
- **Network**: Stable internet connection with public IP or tunnel service

### Software Requirements

- **Docker**: 20.10+
- **Docker Compose**: 2.0+
- **Node.js**: 20+ (if running without Docker)
- **Git**: 2.0+
- **Claude Code CLI**: Latest version

### External Services

- **Redis**: Managed Redis service (e.g., Redis Cloud) or self-hosted
- **GitHub**: Repository access and webhook capability
- **Anthropic API**: Claude API key with sufficient credits

## Quick Start

For the fastest production deployment:

```bash
# 1. Clone repository
git clone https://github.com/yourusername/ai-bug-fixer.git
cd ai-bug-fixer

# 2. Run setup script
bash setup.sh

# 3. Edit .env with your credentials
nano .env

# 4. Start production services
docker-compose -f docker-compose.prod.yml up -d

# 5. Verify deployment
curl http://localhost:3000/health
```

## Exposing to External Services

**If deploying at home (Mac Mini, Raspberry Pi, etc.) or behind a firewall:**

External services like GitHub, Sentry, and CircleCI need to send webhooks to your server. Since your home network typically doesn't have a public IP, you'll need to expose your service using a tunnel.

### Recommended: Cloudflare Tunnel

**Why Cloudflare Tunnel?**
- ✅ **Free** - No cost for unlimited bandwidth
- ✅ **Secure** - No open ports, encrypted tunnel
- ✅ **Custom domain** - Use your own subdomain
- ✅ **HTTPS included** - Automatic SSL certificates
- ✅ **No router config** - Works through NAT/firewall

### Quick Setup (Mac Mini)

```bash
# 1. Install cloudflared
brew install cloudflared

# 2. Authenticate with Cloudflare
cloudflared tunnel login

# 3. Create tunnel
cloudflared tunnel create ai-bug-fixer

# 4. Create config file at ~/.cloudflared/config.yml:
tunnel: <TUNNEL-ID>
credentials-file: /Users/yourusername/.cloudflared/<TUNNEL-ID>.json

ingress:
  - hostname: ai-bug-fixer.yourdomain.com
    service: http://localhost:3000
  - service: http_status:404

# 5. Route DNS
cloudflared tunnel route dns ai-bug-fixer ai-bug-fixer.yourdomain.com

# 6. Start tunnel
cloudflared tunnel run ai-bug-fixer
```

### Run as Background Service

For Mac Mini, create `~/Library/LaunchAgents/com.cloudflare.cloudflared.plist` to auto-start on boot.

**Full guide:** See [EXPOSING-WEBHOOKS.md](./EXPOSING-WEBHOOKS.md) for complete setup instructions including:
- Cloudflare Tunnel (recommended for home deployments)
- Ngrok (quick testing)
- Direct port forwarding
- Tailscale Funnel
- Mac Mini specific optimizations
- Security considerations
- Troubleshooting

**Cost:** ~$1/month (domain name only, Cloudflare Tunnel is free)

### Configure Webhooks

Once your tunnel is running, configure your services:

**GitHub:**
- URL: `https://ai-bug-fixer.yourdomain.com/webhooks/github-issues`
- Secret: Your `GITHUB_WEBHOOK_SECRET` from `.env`

**Sentry:**
- URL: `https://ai-bug-fixer.yourdomain.com/webhooks/sentry`

**CircleCI:**
- URL: `https://ai-bug-fixer.yourdomain.com/webhooks/circleci`

**Verify it works:**
```bash
# From anywhere on the internet
curl https://ai-bug-fixer.yourdomain.com/health
```

## Environment Setup

### 1. Clone Repository

```bash
git clone https://github.com/yourusername/ai-bug-fixer.git
cd ai-bug-fixer
```

### 2. Run Automated Setup

The setup script will guide you through configuration:

```bash
bash setup.sh
```

This script will:
- Check system dependencies
- Create `.env` file from template
- Generate secure webhook secrets
- Configure Docker networking
- Install Node dependencies
- Build Docker images
- Verify Claude CLI authentication

### 3. Configure Environment Variables

Edit `.env` file with your production credentials:

```bash
# Required
GITHUB_TOKEN=ghp_your_token_here
GITHUB_WEBHOOK_SECRET=$(openssl rand -hex 32)
REDIS_URL=redis://localhost:6379

# Optional but recommended
SENTRY_AUTH_TOKEN=your_sentry_token
CIRCLECI_TOKEN=your_circleci_token
DISCORD_WEBHOOK_URL=your_discord_webhook

# Production settings
NODE_ENV=production
LOG_LEVEL=info
LOG_FORMAT=json
WORKER_CONCURRENCY=2
```

### 4. Configure Projects

Edit `router/src/config/projects.ts` to add your repositories:

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
    },
  },
];
```

### 5. Authenticate Claude CLI

```bash
# Authenticate with Anthropic
claude auth

# Verify authentication
claude auth status
```

## Docker Deployment

### Production Docker Compose

The `docker-compose.prod.yml` file is optimized for production with:
- Multi-stage builds for smaller images
- Non-root users for security
- Resource limits
- Health checks
- Automatic restarts
- Structured logging

### Build and Start Services

```bash
# Build images
docker-compose -f docker-compose.prod.yml build

# Start services
docker-compose -f docker-compose.prod.yml up -d

# View logs
docker-compose -f docker-compose.prod.yml logs -f router

# Check status
docker-compose -f docker-compose.prod.yml ps
```

### Verify Deployment

```bash
# Health check
curl http://localhost:3000/health

# Readiness probe
curl http://localhost:3000/ready

# Liveness probe
curl http://localhost:3000/live

# Queue status
curl http://localhost:3000/dashboard
```

### Update Deployment

```bash
# Pull latest changes
git pull origin main

# Rebuild images
docker-compose -f docker-compose.prod.yml build

# Restart services (zero-downtime)
docker-compose -f docker-compose.prod.yml up -d
```

## Kubernetes Deployment

### Prerequisites

- Kubernetes cluster (1.20+)
- kubectl configured
- Persistent volume provisioner

### Apply Kubernetes Manifests

Create `k8s/deployment.yml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: claude-agent-router
spec:
  replicas: 2
  selector:
    matchLabels:
      app: claude-agent-router
  template:
    metadata:
      labels:
        app: claude-agent-router
    spec:
      containers:
      - name: router
        image: your-registry/claude-agent-router:latest
        ports:
        - containerPort: 3000
        env:
        - name: NODE_ENV
          value: "production"
        - name: REDIS_URL
          valueFrom:
            secretKeyRef:
              name: redis-config
              key: url
        - name: GITHUB_TOKEN
          valueFrom:
            secretKeyRef:
              name: github-secrets
              key: token
        livenessProbe:
          httpGet:
            path: /live
            port: 3000
          initialDelaySeconds: 10
          periodSeconds: 30
        readinessProbe:
          httpGet:
            path: /ready
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 10
        resources:
          requests:
            cpu: 500m
            memory: 1Gi
          limits:
            cpu: 2000m
            memory: 2Gi
---
apiVersion: v1
kind: Service
metadata:
  name: claude-agent-router
spec:
  selector:
    app: claude-agent-router
  ports:
  - port: 80
    targetPort: 3000
  type: LoadBalancer
```

Apply configuration:

```bash
# Create secrets
kubectl create secret generic github-secrets --from-literal=token=$GITHUB_TOKEN
kubectl create secret generic redis-config --from-literal=url=$REDIS_URL

# Deploy application
kubectl apply -f k8s/

# Check status
kubectl get pods
kubectl get svc
kubectl logs -f deployment/claude-agent-router
```

## Monitoring and Logging

### Health Check Endpoints

The application provides three health check endpoints:

1. **`/health`** - Comprehensive system health
   - Returns: Status of Redis, queue, triggers, VCS, runners
   - HTTP 200: Healthy
   - HTTP 503: Unhealthy or degraded

2. **`/ready`** - Readiness probe
   - Returns: Whether system is ready to handle requests
   - HTTP 200: Ready
   - HTTP 503: Not ready

3. **`/live`** - Liveness probe
   - Returns: Whether process is alive
   - HTTP 200: Alive
   - HTTP 503: Dead (should restart)

### Structured Logging

All logs are output in JSON format for easy parsing:

```json
{
  "timestamp": "2024-01-10T12:00:00.000Z",
  "level": "info",
  "message": "Claude Agent Router started",
  "service": "claude-agent-router",
  "environment": "production",
  "port": 3000
}
```

Configure logging with environment variables:

```bash
LOG_LEVEL=info      # error | warn | info | debug
LOG_FORMAT=json     # json | pretty
LOG_REQUESTS=true   # Log HTTP requests
```

### Log Aggregation

For production, integrate with a log aggregation service:

**Using ELK Stack:**

```bash
# Filebeat configuration
filebeat.inputs:
- type: docker
  containers.ids:
  - 'claude-agent-*'
  json.keys_under_root: true

output.elasticsearch:
  hosts: ["elasticsearch:9200"]
```

**Using CloudWatch (AWS):**

```json
{
  "logConfiguration": {
    "logDriver": "awslogs",
    "options": {
      "awslogs-group": "/ecs/claude-agent-router",
      "awslogs-region": "us-east-1",
      "awslogs-stream-prefix": "router"
    }
  }
}
```

### Metrics and Monitoring

Monitor key metrics:

**Application Metrics:**
- Queue depth (waiting, active, failed jobs)
- Request rate and latency
- Error rate and types
- Worker utilization

**System Metrics:**
- CPU usage
- Memory usage
- Disk I/O
- Network traffic

**Integration with Prometheus:**

Add `/metrics` endpoint (future enhancement) or use exporters:

```yaml
# docker-compose.prod.yml
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
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
```

## Security Checklist

### Before Deploying to Production

- [ ] **Environment Variables**
  - [ ] All secrets stored in `.env` (never in code)
  - [ ] `.env` added to `.gitignore`
  - [ ] Webhook secrets generated with strong randomness
  - [ ] Tokens have minimum required permissions

- [ ] **Network Security**
  - [ ] Webhook signature validation enabled
  - [ ] Rate limiting configured appropriately
  - [ ] HTTPS/TLS configured (use reverse proxy)
  - [ ] Firewall rules allow only necessary ports

- [ ] **Container Security**
  - [ ] Running as non-root user
  - [ ] Read-only file systems where possible
  - [ ] Docker socket access restricted
  - [ ] Images scanned for vulnerabilities

- [ ] **Access Control**
  - [ ] GitHub token has minimum required scopes
  - [ ] User allowlists configured for triggers
  - [ ] SSH keys properly secured

- [ ] **Data Security**
  - [ ] Redis password protected (if exposed)
  - [ ] Workspace volumes cleaned up after jobs
  - [ ] Sensitive data not logged

### Security Best Practices

**1. Use Managed Redis**

Instead of self-hosting Redis, use a managed service:
- Redis Cloud
- AWS ElastiCache
- Azure Cache for Redis
- Google Cloud Memorystore

**2. Enable HTTPS**

Use a reverse proxy like Nginx or Caddy:

```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

**3. Rotate Secrets Regularly**

```bash
# Generate new webhook secret
NEW_SECRET=$(openssl rand -hex 32)

# Update .env
sed -i "s/GITHUB_WEBHOOK_SECRET=.*/GITHUB_WEBHOOK_SECRET=$NEW_SECRET/" .env

# Update GitHub webhook settings
# Restart application
docker-compose -f docker-compose.prod.yml restart router
```

## Troubleshooting

### Common Issues

#### 1. Redis Connection Failed

**Symptoms:**
```
Error: Redis connection failed
ECONNREFUSED 127.0.0.1:6379
```

**Solutions:**
- Check Redis is running: `docker-compose ps redis`
- Verify REDIS_URL environment variable
- Check Redis logs: `docker-compose logs redis`
- Test connection: `redis-cli -u $REDIS_URL ping`

#### 2. Webhook Signature Validation Failed

**Symptoms:**
```
Webhook signature validation failed
```

**Solutions:**
- Verify GITHUB_WEBHOOK_SECRET matches GitHub settings
- Check webhook recent deliveries in GitHub
- Ensure secret has no leading/trailing whitespace
- Regenerate secret if unsure

#### 3. Docker Socket Permission Denied

**Symptoms:**
```
Error: Cannot connect to Docker daemon
permission denied
```

**Solutions:**
- Add user to docker group: `sudo usermod -aG docker $USER`
- Restart Docker service: `sudo systemctl restart docker`
- Check socket permissions: `ls -l /var/run/docker.sock`

#### 4. Claude CLI Not Authenticated

**Symptoms:**
```
Error: Claude CLI not authenticated
```

**Solutions:**
- Run: `claude auth`
- Verify: `claude auth status`
- Ensure ~/.claude directory is mounted correctly
- Check volume permissions

#### 5. Out of Memory

**Symptoms:**
```
JavaScript heap out of memory
Container killed (OOMKilled)
```

**Solutions:**
- Increase Docker memory limit
- Reduce WORKER_CONCURRENCY
- Add swap space
- Upgrade server resources

### Debug Mode

Enable debug logging:

```bash
# Set environment variable
LOG_LEVEL=debug

# Restart services
docker-compose -f docker-compose.prod.yml restart router

# View detailed logs
docker-compose -f docker-compose.prod.yml logs -f router
```

### Check System Health

```bash
# Application health
curl http://localhost:3000/health | jq

# Queue statistics
curl http://localhost:3000/dashboard | jq

# Redis status
docker-compose exec redis redis-cli INFO

# Container resource usage
docker stats
```

## Scaling

### Horizontal Scaling

Run multiple router instances:

```yaml
# docker-compose.prod.yml
services:
  router:
    # ...
    deploy:
      replicas: 3
```

Or with Docker Swarm:

```bash
docker service scale claude-agent-router=3
```

### Vertical Scaling

Increase resources per instance:

```yaml
deploy:
  resources:
    limits:
      cpus: '4'
      memory: 8G
```

### Worker Concurrency

Adjust based on workload:

```bash
# Light workload
WORKER_CONCURRENCY=1

# Medium workload
WORKER_CONCURRENCY=2

# Heavy workload (with sufficient resources)
WORKER_CONCURRENCY=4
```

### Redis Scaling

For high-volume deployments:
- Use Redis cluster mode
- Enable persistence (AOF + RDB)
- Use managed Redis service with auto-scaling

### Load Balancing

Use Nginx or HAProxy:

```nginx
upstream claude_agent {
    least_conn;
    server 127.0.0.1:3001;
    server 127.0.0.1:3002;
    server 127.0.0.1:3003;
}

server {
    listen 80;
    location / {
        proxy_pass http://claude_agent;
    }
}
```

## Backup and Recovery

### Backup Redis Data

```bash
# Manual backup
docker-compose exec redis redis-cli SAVE
docker cp claude-agent-redis:/data/dump.rdb ./backups/redis-$(date +%Y%m%d).rdb

# Automated daily backups
0 2 * * * /path/to/backup-redis.sh
```

### Backup Configuration

```bash
# Backup .env and config files
tar -czf config-backup-$(date +%Y%m%d).tar.gz .env router/src/config/
```

### Disaster Recovery

```bash
# Restore Redis data
docker-compose down
cp backups/redis-20240110.rdb /var/lib/docker/volumes/claude-agent-redis-data/_data/dump.rdb
docker-compose up -d

# Restore configuration
tar -xzf config-backup-20240110.tar.gz
```

## Support

For additional help:
- Check [README.md](./README.md) for general information
- Review plugin-specific READMEs in their directories
- Open an issue on GitHub
- Consult Claude Code documentation
