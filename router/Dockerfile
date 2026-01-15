# =============================================================================
# Build Stage
# =============================================================================
FROM node:20-slim AS builder

WORKDIR /build

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including devDependencies for building)
RUN npm ci

# Copy source files for Next.js
COPY tsconfig.json ./
COPY tsconfig.worker.json ./
COPY next.config.js ./
COPY postcss.config.js ./
COPY tailwind.config.ts ./
COPY src ./src
COPY app ./app
COPY components ./components
COPY lib ./lib

# Build Next.js app and worker
RUN npm run build

# =============================================================================
# Production Stage
# =============================================================================
FROM node:20-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    docker.io \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Create non-root user
RUN groupadd -r appuser && useradd -r -g appuser -u 1001 appuser

WORKDIR /app

# Copy built application from builder
COPY --from=builder --chown=appuser:appuser /build/.next ./.next
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
    CMD curl -f http://localhost:3000/api/live || exit 1

# Default to web server (override with command for worker)
CMD ["npm", "run", "start"]

# Labels for metadata
LABEL maintainer="ai-bug-fixer"
LABEL version="1.0.0"
LABEL description="AI Bug Fixer Router - Next.js web app and worker"
