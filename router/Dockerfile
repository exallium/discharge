# =============================================================================
# Build Stage
# =============================================================================
FROM node:20-slim AS builder

WORKDIR /build

# Copy root workspace files
COPY package*.json ./
COPY packages ./packages

# Copy router package files
COPY router/package*.json ./router/

# Install build tools for native modules
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# Install ALL dependencies (including devDependencies for building)
# Using npm install instead of npm ci since workspace packages are local
# --ignore-scripts skips husky prepare script which isn't needed in Docker
RUN npm install --workspaces --ignore-scripts

# Rebuild native modules (bcrypt, etc.) that were skipped
RUN npm rebuild bcrypt

# Build workspace packages first (SDK, service-locator, services)
RUN npm run build --workspace=@ai-bug-fixer/service-sdk
RUN npm run build --workspace=@ai-bug-fixer/service-locator
RUN npm run build --workspace=@ai-bug-fixer/service-github
RUN npm run build --workspace=@ai-bug-fixer/service-sentry
RUN npm run build --workspace=@ai-bug-fixer/service-circleci
RUN npm run build --workspace=@ai-bug-fixer/service-claude-code

# Copy router source files for Next.js
COPY router/tsconfig.json ./router/
COPY router/tsconfig.worker.json ./router/
COPY router/next.config.js ./router/
COPY router/postcss.config.js ./router/
COPY router/tailwind.config.ts ./router/
COPY router/src ./router/src
COPY router/app ./router/app
COPY router/components ./router/components
COPY router/lib ./router/lib

# Build Next.js app and worker
RUN npm run build --workspace=ai-bug-fixer-router

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

# Copy workspace packages (dist only needed at runtime)
COPY --from=builder --chown=appuser:appuser /build/packages ./packages

# Copy built router application from builder
COPY --from=builder --chown=appuser:appuser /build/router/.next ./router/.next
COPY --from=builder --chown=appuser:appuser /build/router/dist ./router/dist
COPY --from=builder --chown=appuser:appuser /build/node_modules ./node_modules
COPY --from=builder --chown=appuser:appuser /build/package*.json ./
COPY --from=builder --chown=appuser:appuser /build/router/package*.json ./router/

# Create directories with proper permissions
RUN mkdir -p /workspaces && chown appuser:appuser /workspaces

# Set working directory to router for npm commands
WORKDIR /app/router

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
