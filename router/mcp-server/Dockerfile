# MCP Server for AI Bug Fixer
# Provides read-only access to bug tracking integrations

FROM node:20-slim

# Install only what we need
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files first for layer caching
COPY package.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm install

# Copy source
COPY src/ ./src/

# Build TypeScript
RUN npm run build

# Remove dev dependencies to minimize image size
RUN npm prune --production

# Run as non-root user
RUN useradd -m -s /bin/bash mcpuser
USER mcpuser

# Expose SSE port (configurable via MCP_PORT env var)
EXPOSE 3001

# Default to SSE transport
ENV MCP_TRANSPORT=sse
ENV MCP_PORT=3001

CMD ["node", "dist/index.js"]
