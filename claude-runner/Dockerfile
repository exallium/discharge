FROM node:20-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    curl \
    jq \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

# Configure git
RUN git config --global user.email "claude-bot@autofix.local" \
    && git config --global user.name "Claude Agent" \
    && git config --global init.defaultBranch main

# Create non-root user
RUN useradd -m claude
USER claude

# Set working directory
WORKDIR /workspace

# Claude Code CLI is the entrypoint
ENTRYPOINT ["claude"]
