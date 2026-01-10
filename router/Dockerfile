# =============================================================================
# Build Stage
# =============================================================================
FROM node:20-slim AS builder

WORKDIR /build

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including devDependencies for building)
RUN npm ci

# Copy source files
COPY tsconfig.json ./
COPY src ./src

# Build TypeScript
RUN npm run build

# Remove dev dependencies
RUN npm prune --production

# =============================================================================
# Production Stage
# =============================================================================
FROM node:20-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    docker.io \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Create non-root user
RUN groupadd -r appuser && useradd -r -g appuser -u 1001 appuser

WORKDIR /app

# Copy built application from builder
COPY --from=builder --chown=appuser:appuser /build/dist ./dist
COPY --from=builder --chown=appuser:appuser /build/node_modules ./node_modules
COPY --from=builder --chown=appuser:appuser /build/package*.json ./

# Create directories with proper permissions
RUN mkdir -p /workspaces && chown appuser:appuser /workspaces

# Switch to non-root user
USER appuser

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); }).on('error', () => process.exit(1));"

# Start the router
CMD ["node", "dist/index.js"]

# Labels for metadata
LABEL maintainer="ai-bug-fixer"
LABEL version="1.0.0"
LABEL description="AI Bug Fixer Router - Webhook orchestrator and job queue"
