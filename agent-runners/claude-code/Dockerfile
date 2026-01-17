# =============================================================================
# Claude Code Agent Runner
# =============================================================================
# This container runs the Claude Code CLI for automated bug investigation
# and fixing. It's spawned dynamically by the ClaudeCodeRunner plugin.
#
# Image: agent-runner-claude:latest
# Plugin: router/src/runner/runners/claude-code/
# =============================================================================

FROM node:20-bookworm

# Build arguments for optional components
ARG INSTALL_RUST=true
ARG INSTALL_PYTHON=true
ARG INSTALL_GO=true
ARG INSTALL_DOCKER=true

# ─────────────────────────────────────────────
# System Dependencies
# ─────────────────────────────────────────────
RUN apt-get update && apt-get install -y \
    # Essential tools
    git \
    curl \
    wget \
    jq \
    unzip \
    ca-certificates \
    gnupg \
    lsb-release \
    # Build essentials (for native modules)
    build-essential \
    pkg-config \
    libssl-dev \
    # Database clients
    postgresql-client \
    # Network tools
    netcat-openbsd \
    dnsutils \
    && rm -rf /var/lib/apt/lists/*

# ─────────────────────────────────────────────
# Docker CLI (for running service containers like Supabase)
# ─────────────────────────────────────────────
RUN if [ "$INSTALL_DOCKER" = "true" ]; then \
    install -m 0755 -d /etc/apt/keyrings && \
    curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg && \
    chmod a+r /etc/apt/keyrings/docker.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian $(lsb_release -cs) stable" > /etc/apt/sources.list.d/docker.list && \
    apt-get update && \
    apt-get install -y docker-ce-cli docker-compose-plugin && \
    rm -rf /var/lib/apt/lists/* ; \
    fi

# ─────────────────────────────────────────────
# Rust Toolchain
# ─────────────────────────────────────────────
ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:$PATH

RUN if [ "$INSTALL_RUST" = "true" ]; then \
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable && \
    rustup component add clippy rustfmt && \
    cargo install cargo-watch cargo-edit ; \
    fi

# ─────────────────────────────────────────────
# Python
# ─────────────────────────────────────────────
RUN if [ "$INSTALL_PYTHON" = "true" ]; then \
    apt-get update && \
    apt-get install -y python3 python3-pip python3-venv && \
    rm -rf /var/lib/apt/lists/* && \
    pip3 install --break-system-packages pipx && \
    pipx ensurepath ; \
    fi

# ─────────────────────────────────────────────
# Go
# ─────────────────────────────────────────────
ENV GOPATH=/go \
    PATH=/usr/local/go/bin:/go/bin:$PATH

RUN if [ "$INSTALL_GO" = "true" ]; then \
    GO_VERSION="1.22.0" && \
    curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-$(dpkg --print-architecture).tar.gz" | tar -C /usr/local -xz ; \
    fi

# ─────────────────────────────────────────────
# Supabase CLI (via .deb package from GitHub releases)
# ─────────────────────────────────────────────
RUN SUPABASE_VERSION="2.72.7" && \
    ARCH=$(dpkg --print-architecture) && \
    curl -fsSL "https://github.com/supabase/cli/releases/download/v${SUPABASE_VERSION}/supabase_${SUPABASE_VERSION}_linux_${ARCH}.deb" -o /tmp/supabase.deb && \
    dpkg -i /tmp/supabase.deb && \
    rm /tmp/supabase.deb

# ─────────────────────────────────────────────
# Node.js Tools (npm global packages)
# ─────────────────────────────────────────────
# Enable corepack for yarn/pnpm (already included in node image)
RUN corepack enable

RUN npm install -g \
    # Claude Code CLI
    @anthropic-ai/claude-code \
    # TypeScript
    typescript \
    ts-node \
    # Testing
    jest \
    vitest \
    # Linting/Formatting
    eslint \
    prettier \
    # Database/Backend
    prisma \
    drizzle-kit \
    # Utilities
    turbo \
    nx \
    concurrently \
    dotenv-cli

# ─────────────────────────────────────────────
# Git Configuration
# ─────────────────────────────────────────────
RUN git config --global user.email "ai-agent@autofix.local" \
    && git config --global user.name "AI Agent" \
    && git config --global init.defaultBranch main \
    && git config --global --add safe.directory /workspace

# ─────────────────────────────────────────────
# Create agent user with Docker group access
# ─────────────────────────────────────────────
RUN groupadd -g 999 docker 2>/dev/null || true \
    && useradd -m -G docker agent

# Environment for the agent
ENV HOME=/home/agent \
    PATH="/home/agent/.local/bin:$PATH"

USER agent

# Set working directory (repo will be mounted here)
WORKDIR /workspace

# Claude Code CLI is the entrypoint
ENTRYPOINT ["claude"]
