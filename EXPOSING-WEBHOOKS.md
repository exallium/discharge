# Exposing Webhooks to External Services

When running AI Bug Fixer at home (like on a Mac Mini) or behind a firewall, you need to expose your webhook endpoint so that GitHub, Sentry, and CircleCI can send events to it. This guide covers several options with a focus on Cloudflare Tunnel.

## Table of Contents

- [Why You Need This](#why-you-need-this)
- [Option 1: Cloudflare Tunnel (Recommended)](#option-1-cloudflare-tunnel-recommended)
- [Option 2: Ngrok](#option-2-ngrok)
- [Option 3: Direct Port Forwarding](#option-3-direct-port-forwarding)
- [Option 4: Tailscale Funnel](#option-4-tailscale-funnel)
- [Mac Mini Specific Setup](#mac-mini-specific-setup)
- [Security Considerations](#security-considerations)
- [Troubleshooting](#troubleshooting)

## Why You Need This

**The Problem:**
- Your Mac Mini is on your home network behind a router/firewall
- It doesn't have a public IP address
- External services (GitHub, Sentry) can't reach it directly
- You need `https://your-domain.com/webhooks/*` to be accessible from the internet

**The Solution:**
- Create a secure tunnel from your home network to the internet
- Tunnel services provide a public URL that forwards traffic to your local machine
- No need to open ports on your router or change firewall settings

## Option 1: Cloudflare Tunnel (Recommended)

**Best for:** Production deployments, free tier available, excellent performance

### Why Cloudflare Tunnel?

✅ **Free** - No cost for basic usage
✅ **Secure** - Encrypted tunnel, no open ports
✅ **Reliable** - Cloudflare's global network
✅ **Fast** - Edge locations worldwide
✅ **HTTPS** - Automatic SSL/TLS certificates
✅ **No router changes** - Works through NAT/firewall
✅ **Custom domains** - Use your own domain name

### Prerequisites

1. **Cloudflare account** (free tier is fine)
2. **Domain name** managed by Cloudflare
   - Can use a subdomain like `ai-bug-fixer.yourdomain.com`
   - Free domains: Freenom, or use Cloudflare Registrar

### Setup Guide

#### Step 1: Install cloudflared

**On macOS (Mac Mini):**
```bash
brew install cloudflared
```

**On Linux:**
```bash
# Debian/Ubuntu
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared-linux-amd64.deb

# Other distributions
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
chmod +x cloudflared-linux-amd64
sudo mv cloudflared-linux-amd64 /usr/local/bin/cloudflared
```

**Verify installation:**
```bash
cloudflared --version
```

#### Step 2: Authenticate with Cloudflare

```bash
cloudflared tunnel login
```

This opens a browser window. Select your domain from the list.

#### Step 3: Create a Tunnel

```bash
# Create a tunnel named 'ai-bug-fixer'
cloudflared tunnel create ai-bug-fixer
```

This creates:
- A tunnel ID (save this!)
- A credentials file at `~/.cloudflared/<TUNNEL-ID>.json`

**Important:** Note your tunnel ID from the output.

#### Step 4: Create Configuration File

Create `~/.cloudflared/config.yml`:

```yaml
tunnel: <YOUR-TUNNEL-ID>
credentials-file: /Users/yourusername/.cloudflared/<TUNNEL-ID>.json

ingress:
  # Route webhooks to AI Bug Fixer
  - hostname: ai-bug-fixer.yourdomain.com
    service: http://localhost:3000

  # Catch-all rule (required)
  - service: http_status:404
```

**For Mac Mini specifically:**
- Replace `yourusername` with your actual username
- Use full path to credentials file
- Ensure AI Bug Fixer runs on port 3000

#### Step 5: Configure DNS

```bash
# Create DNS record pointing to your tunnel
cloudflared tunnel route dns ai-bug-fixer ai-bug-fixer.yourdomain.com
```

This creates a CNAME record in Cloudflare DNS.

#### Step 6: Start the Tunnel

**Test run:**
```bash
cloudflared tunnel run ai-bug-fixer
```

**Run as a service (recommended for Mac Mini):**

Create `~/Library/LaunchAgents/com.cloudflare.cloudflared.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.cloudflare.cloudflared</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/bin/cloudflared</string>
        <string>tunnel</string>
        <string>--config</string>
        <string>/Users/yourusername/.cloudflared/config.yml</string>
        <string>run</string>
        <string>ai-bug-fixer</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardErrorPath</key>
    <string>/tmp/cloudflared.err</string>
    <key>StandardOutPath</key>
    <string>/tmp/cloudflared.out</string>
</dict>
</plist>
```

**Load and start:**
```bash
launchctl load ~/Library/LaunchAgents/com.cloudflare.cloudflared.plist
launchctl start com.cloudflare.cloudflared
```

**Check status:**
```bash
launchctl list | grep cloudflared
tail -f /tmp/cloudflared.out
```

#### Step 7: Test the Tunnel

```bash
# From your Mac Mini
curl http://localhost:3000/health

# From anywhere on the internet
curl https://ai-bug-fixer.yourdomain.com/health
```

Both should return the same health check response.

#### Step 8: Configure Webhooks

Now configure your services to send webhooks to:

**GitHub:**
- Webhook URL: `https://ai-bug-fixer.yourdomain.com/webhooks/github-issues`
- Content type: `application/json`
- Secret: Your `GITHUB_WEBHOOK_SECRET`

**Sentry:**
- Webhook URL: `https://ai-bug-fixer.yourdomain.com/webhooks/sentry`

**CircleCI:**
- Webhook URL: `https://ai-bug-fixer.yourdomain.com/webhooks/circleci`

### Managing the Tunnel

**Stop tunnel:**
```bash
launchctl stop com.cloudflare.cloudflared
```

**Restart tunnel:**
```bash
launchctl stop com.cloudflare.cloudflared
launchctl start com.cloudflare.cloudflared
```

**View logs:**
```bash
tail -f /tmp/cloudflared.out
tail -f /tmp/cloudflared.err
```

**List all tunnels:**
```bash
cloudflared tunnel list
```

**Delete tunnel:**
```bash
cloudflared tunnel delete ai-bug-fixer
```

### Docker Integration (Optional)

If you're running AI Bug Fixer with Docker Compose, you can include cloudflared in your stack:

Add to `docker-compose.prod.yml`:

```yaml
services:
  # ... existing services ...

  tunnel:
    image: cloudflare/cloudflared:latest
    container_name: ai-bug-fixer-tunnel
    command: tunnel --no-autoupdate run
    environment:
      - TUNNEL_TOKEN=${CLOUDFLARE_TUNNEL_TOKEN}
    networks:
      - internal
    restart: unless-stopped
    depends_on:
      - router
```

**Get tunnel token:**
```bash
cloudflared tunnel token ai-bug-fixer
```

Add token to `.env`:
```bash
CLOUDFLARE_TUNNEL_TOKEN=<your-token>
```

### Advanced Configuration

**Multiple subdomains:**

```yaml
# ~/.cloudflared/config.yml
tunnel: <TUNNEL-ID>
credentials-file: /Users/yourusername/.cloudflared/<TUNNEL-ID>.json

ingress:
  # Production
  - hostname: ai-bug-fixer.yourdomain.com
    service: http://localhost:3000

  # Staging
  - hostname: staging.ai-bug-fixer.yourdomain.com
    service: http://localhost:3001

  # Monitoring dashboard
  - hostname: monitor.ai-bug-fixer.yourdomain.com
    service: http://localhost:9090

  # Catch-all
  - service: http_status:404
```

**Access control:**

Enable Cloudflare Access for authentication:

```yaml
ingress:
  - hostname: ai-bug-fixer.yourdomain.com
    service: http://localhost:3000
    originRequest:
      noTLSVerify: false
```

Then configure Access policies in Cloudflare dashboard.

## Option 2: Ngrok

**Best for:** Development, testing, quick setup

### Pros
- ✅ Very easy to set up
- ✅ Free tier available
- ✅ Built-in inspection UI
- ✅ No domain required

### Cons
- ❌ Free tier has limitations (2hr timeout, random URLs)
- ❌ Paid tier required for production ($8-12/month)
- ❌ Less reliable than Cloudflare
- ❌ URLs change on restart (free tier)

### Setup

**Install:**
```bash
brew install ngrok
```

**Authenticate:**
```bash
ngrok authtoken <your-auth-token>
```

**Start tunnel:**
```bash
ngrok http 3000
```

**With custom domain (paid):**
```bash
ngrok http --domain=ai-bug-fixer.yourdomain.com 3000
```

**Configuration file** (`~/.ngrok2/ngrok.yml`):
```yaml
authtoken: <your-auth-token>
region: us
tunnels:
  ai-bug-fixer:
    proto: http
    addr: 3000
    domain: ai-bug-fixer.yourdomain.com  # Paid feature
```

**Run:**
```bash
ngrok start ai-bug-fixer
```

### Run as Service on Mac

Create `~/Library/LaunchAgents/com.ngrok.agent.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.ngrok.agent</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/bin/ngrok</string>
        <string>start</string>
        <string>ai-bug-fixer</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
</dict>
</plist>
```

## Option 3: Direct Port Forwarding

**Best for:** Fixed public IP, home server with DMZ

### Pros
- ✅ No third-party service
- ✅ Free
- ✅ Complete control

### Cons
- ❌ Requires public IP (not always available)
- ❌ Security risk if misconfigured
- ❌ Need to manage SSL certificates
- ❌ Router configuration required
- ❌ Exposed to internet attacks

### Setup (Not Recommended for Mac Mini)

1. **Configure router port forwarding:**
   - Forward port 443 → Mac Mini IP:3000

2. **Set up reverse proxy (Caddy or Nginx):**
   ```bash
   # Caddyfile
   ai-bug-fixer.yourdomain.com {
       reverse_proxy localhost:3000
   }
   ```

3. **Update DNS:**
   - Point A record to your public IP

**Security concerns:**
- Mac Mini directly exposed to internet
- Need firewall rules
- Need to manage SSL/TLS
- DDoS vulnerability

## Option 4: Tailscale Funnel

**Best for:** Private networks, team access

### Pros
- ✅ Built on WireGuard
- ✅ Easy setup
- ✅ Good for private access

### Cons
- ❌ Limited public access features
- ❌ Beta feature
- ❌ Not designed for webhooks

### Setup

```bash
# Install Tailscale
brew install tailscale

# Start Tailscale
sudo tailscale up

# Enable funnel (beta)
tailscale funnel 3000
```

**Note:** Tailscale Funnel is primarily for team/private access, not ideal for public webhooks from GitHub/Sentry.

## Mac Mini Specific Setup

### Optimization for Home Server

**1. Energy Settings:**
```bash
# Prevent sleep when lid closed (if using laptop mode)
sudo pmset -c sleep 0
sudo pmset -c disksleep 0

# Or use caffeinate
caffeinate -s &
```

**2. Auto-start on boot:**

All services should start automatically:
- Cloudflared (via LaunchAgent)
- Docker (via Desktop settings)
- AI Bug Fixer (via docker-compose restart policy)

**3. Monitor with:**

```bash
# System resources
top
htop

# Tunnel status
tail -f /tmp/cloudflared.out

# AI Bug Fixer logs
docker-compose -f docker-compose.prod.yml logs -f

# Webhook traffic
curl https://ai-bug-fixer.yourdomain.com/dashboard
```

**4. Backup strategy:**

```bash
# Automated daily backup of Redis data
0 2 * * * docker-compose exec redis redis-cli SAVE && \
  rsync -avz /var/lib/docker/volumes/ai-bug-fixer-redis-data/_data/ \
  /Volumes/Backup/ai-bug-fixer/redis-$(date +\%Y\%m\%d)/
```

### Network Considerations

**Static local IP:**

Set static IP for Mac Mini in router DHCP settings:
- Prevents IP changes on restart
- Easier to manage

**Firewall:**

macOS built-in firewall is fine. Enable in:
- System Preferences → Security & Privacy → Firewall

Allow:
- Docker
- cloudflared
- Terminal/iTerm (if running commands)

## Security Considerations

### Webhook Signature Validation

**Critical:** Always validate webhook signatures!

The router already implements this:
- GitHub: `x-hub-signature-256` HMAC validation
- Sentry: Optional (not signed)
- CircleCI: Token validation

**Verify in logs:**
```bash
docker-compose logs -f router | grep "Webhook signature"
```

### Rate Limiting

Already implemented in production configuration:
- 60 webhooks/min per IP
- 100 API requests/min per IP

### IP Filtering (Optional)

If you want extra security, configure Cloudflare firewall rules:

**GitHub IP ranges:**
```
192.30.252.0/22
185.199.108.0/22
140.82.112.0/20
143.55.64.0/20
2a0a:a440::/29
2606:50c0::/32
```

**In Cloudflare Dashboard:**
1. Go to Security → WAF
2. Create firewall rule:
   - Expression: `(http.request.uri.path contains "/webhooks/github-issues") and (not ip.src in {<GitHub IPs>})`
   - Action: Block

### SSL/TLS

Cloudflare Tunnel provides automatic HTTPS:
- ✅ Certificate management
- ✅ TLS 1.3
- ✅ Auto-renewal

No additional configuration needed!

### Access Logs

Monitor access:
```bash
# Cloudflare logs (in dashboard)
# Real-time
cloudflared tunnel info ai-bug-fixer

# AI Bug Fixer logs
docker-compose logs -f router | grep "HTTP Request"
```

## Troubleshooting

### Tunnel Not Connecting

**Check cloudflared status:**
```bash
# If using launchd
launchctl list | grep cloudflared

# Check logs
tail -f /tmp/cloudflared.err

# Test connection
cloudflared tunnel info ai-bug-fixer
```

**Common issues:**
- Credentials file path wrong
- Tunnel ID mismatch in config
- Firewall blocking cloudflared

### Webhooks Not Arriving

**Test external access:**
```bash
# From outside your network (use phone hotspot)
curl https://ai-bug-fixer.yourdomain.com/health

# Should return health check JSON
```

**Check webhook deliveries in GitHub:**
1. Repository → Settings → Webhooks
2. Click your webhook
3. "Recent Deliveries" tab
4. Check response codes and bodies

**Common issues:**
- Wrong webhook URL
- Signature validation failing (check `GITHUB_WEBHOOK_SECRET`)
- Router not running

### Mac Mini Network Issues

**Check local server:**
```bash
# Should work on Mac Mini
curl http://localhost:3000/health

# Should work from same network
curl http://<mac-mini-ip>:3000/health
```

**Check Docker:**
```bash
docker ps
docker-compose -f docker-compose.prod.yml ps
```

### Performance Issues

**Monitor Cloudflare tunnel:**
```bash
cloudflared tunnel info ai-bug-fixer
```

**Check bandwidth:**
- Cloudflare free tier is unlimited
- Bottleneck is usually your home internet upload speed

**Optimize:**
- Use Cloudflare's Argo Tunnel (paid, $5/month)
- Reduce log verbosity
- Increase Mac Mini resources

## Cost Comparison

### Cloudflare Tunnel
- **Free tier:** ✅ Unlimited bandwidth
- **Custom domain:** $9-12/year (domain registration)
- **Total:** ~$1/month

### Ngrok
- **Free tier:** ⚠️ Limited (2hr timeout, random URLs)
- **Paid tier:** $8/month (static domain, no timeout)
- **Total:** $8/month

### Direct Port Forwarding
- **Cost:** Free
- **Caveats:** Requires public IP, SSL management, security setup

### Recommended Setup

**For Mac Mini at home:**
```
Mac Mini ($0 - you already have it)
├─ Docker + AI Bug Fixer (free)
├─ Cloudflare Tunnel (free)
└─ Custom subdomain ($1/month)

Total: ~$1/month + Anthropic API usage
```

## Quick Start Checklist

- [ ] Install cloudflared on Mac Mini
- [ ] Create Cloudflare account and add domain
- [ ] Authenticate: `cloudflared tunnel login`
- [ ] Create tunnel: `cloudflared tunnel create ai-bug-fixer`
- [ ] Create config file at `~/.cloudflared/config.yml`
- [ ] Route DNS: `cloudflared tunnel route dns ai-bug-fixer <subdomain>`
- [ ] Create LaunchAgent plist file
- [ ] Load service: `launchctl load ~/Library/LaunchAgents/...`
- [ ] Test: `curl https://<subdomain>/health`
- [ ] Configure webhooks in GitHub/Sentry/CircleCI
- [ ] Monitor: `tail -f /tmp/cloudflared.out`

## Additional Resources

- [Cloudflare Tunnel Docs](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/)
- [GitHub Webhook IPs](https://api.github.com/meta)
- [Docker for Mac](https://docs.docker.com/desktop/install/mac-install/)
- [macOS LaunchAgents Guide](https://www.launchd.info/)
