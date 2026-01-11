# =============================================================================
# Claude Code Agent Runner
# =============================================================================
# This container runs the Claude Code CLI for automated bug investigation
# and fixing. It's spawned dynamically by the ClaudeCodeRunner plugin.
#
# Image: agent-runner-claude:latest
# Plugin: router/src/runner/runners/claude-code/
# =============================================================================

FROM node:20-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    curl \
    jq \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

# Configure git for automated commits
RUN git config --global user.email "ai-agent@autofix.local" \
    && git config --global user.name "AI Agent" \
    && git config --global init.defaultBranch main

# Create non-root user for security
RUN useradd -m agent
USER agent

# Set working directory (repo will be mounted here)
WORKDIR /workspace

# Claude Code CLI is the entrypoint
ENTRYPOINT ["claude"]