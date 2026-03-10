#!/bin/bash

# =============================================================================
# Discharge - Automated Setup Script
# =============================================================================
# This script helps you set up the Discharge environment
# Run with: bash setup.sh
# =============================================================================

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
NC='\033[0m' # No Color

# Helper functions
print_header() {
    echo -e "\n${PURPLE}========================================${NC}"
    echo -e "${PURPLE}$1${NC}"
    echo -e "${PURPLE}========================================${NC}\n"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC}  $1"
}

print_info() {
    echo -e "${BLUE}ℹ${NC}  $1"
}

# Check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Main setup
main() {
    print_header "Discharge Setup"

    echo "This script will guide you through setting up Discharge."
    echo "It will check dependencies, create configuration files, and prepare your environment."
    echo ""
    read -p "Press Enter to continue..."

    # Step 1: Check system dependencies
    check_dependencies

    # Step 2: Setup environment file
    setup_env_file

    # Step 3: Setup Docker
    setup_docker

    # Step 4: Setup Redis
    setup_redis

    # Step 5: Install Node dependencies
    install_node_dependencies

    # Step 6: Build Docker images
    build_docker_images

    # Step 7: Verify Claude CLI authentication
    verify_claude_auth

    # Step 8: Install Discharge CLI (optional)
    install_discharge_cli

    # Step 9: Run tests
    run_tests

    # Done!
    print_header "Setup Complete!"
    print_success "Discharge is ready to use"
    echo ""
    print_info "Quick start:"
    echo "  npm run dev:up         - Start Postgres, Redis, and dev server"
    echo "  npm run worker:dev     - Start the job worker (separate terminal)"
    echo ""
    print_info "Then visit http://localhost:3000 to set your admin password."
    echo ""
    if command_exists discharge; then
        print_info "CLI setup (run from your project directory):"
        echo "  discharge init         - Connect a project to Discharge"
        echo "  discharge push \"Fix X\" - Submit a task"
        echo ""
    fi
    print_info "Other commands:"
    echo "  npm test               - Run tests"
    echo "  npm run dev            - Start dev server only"
    echo "  npm run db:studio      - Open database viewer"
    echo ""
}

# Check system dependencies
check_dependencies() {
    print_header "Checking System Dependencies"

    local missing_deps=()

    # Check Node.js
    if command_exists node; then
        NODE_VERSION=$(node --version)
        print_success "Node.js $NODE_VERSION"

        # Check version (need >= 20)
        NODE_MAJOR=$(echo $NODE_VERSION | cut -d'v' -f2 | cut -d'.' -f1)
        if [ "$NODE_MAJOR" -lt 20 ]; then
            print_error "Node.js 20 or higher is required (you have $NODE_VERSION)"
            missing_deps+=("node>=20")
        fi
    else
        print_error "Node.js not found"
        missing_deps+=("node")
    fi

    # Check npm
    if command_exists npm; then
        NPM_VERSION=$(npm --version)
        print_success "npm $NPM_VERSION"
    else
        print_error "npm not found"
        missing_deps+=("npm")
    fi

    # Check Docker
    if command_exists docker; then
        DOCKER_VERSION=$(docker --version | cut -d' ' -f3 | cut -d',' -f1)
        print_success "Docker $DOCKER_VERSION"

        # Check if Docker is running
        if docker info >/dev/null 2>&1; then
            print_success "Docker daemon is running"
        else
            print_warning "Docker is installed but not running"
            print_info "Please start Docker and run this script again"
            exit 1
        fi
    else
        print_error "Docker not found"
        missing_deps+=("docker")
    fi

    # Check Docker Compose
    if command_exists docker-compose || docker compose version >/dev/null 2>&1; then
        print_success "Docker Compose available"
    else
        print_error "Docker Compose not found"
        missing_deps+=("docker-compose")
    fi

    # Check Git
    if command_exists git; then
        GIT_VERSION=$(git --version | cut -d' ' -f3)
        print_success "Git $GIT_VERSION"
    else
        print_error "Git not found"
        missing_deps+=("git")
    fi

    # Check Claude CLI (required for the runner)
    if command_exists claude; then
        CLAUDE_VERSION=$(claude --version 2>/dev/null || echo "unknown")
        print_success "Claude Code CLI installed ($CLAUDE_VERSION)"
    else
        print_warning "Claude Code CLI not found"
        print_info "Claude CLI is required for Discharge to run AI agents"
        print_info "Install from: https://github.com/anthropics/claude-code"
    fi

    # Exit if missing critical dependencies
    if [ ${#missing_deps[@]} -gt 0 ]; then
        print_error "Missing required dependencies: ${missing_deps[*]}"
        echo ""
        print_info "Please install missing dependencies and run this script again"
        echo ""
        print_info "Installation guides:"
        echo "  Node.js: https://nodejs.org/"
        echo "  Docker: https://docs.docker.com/get-docker/"
        echo "  Git: https://git-scm.com/downloads"
        echo "  Claude CLI: https://github.com/anthropics/claude-code"
        exit 1
    fi
}

# Setup environment file
setup_env_file() {
    print_header "Setting Up Environment File"

    if [ -f ".env" ]; then
        print_warning ".env file already exists"
        read -p "Do you want to overwrite it? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            print_info "Keeping existing .env file"
            return
        fi
    fi

    if [ ! -f ".env.example" ]; then
        print_warning ".env.example not found, skipping env setup"
        return
    fi

    # Copy example file
    cp .env.example .env
    print_success "Created .env file from template"

    # Prompt for configuration
    print_info "Let's configure your environment variables"
    echo ""

    # Admin password
    print_info "Set an admin password for the Discharge web UI and CLI."
    print_info "If you skip this, a random password will be generated on first"
    print_info "startup and printed to the console. You can set a permanent"
    print_info "password later at http://localhost:3000/setup"
    echo ""
    read -s -p "Admin password (press Enter to skip): " ADMIN_PASSWORD
    echo
    if [ -n "$ADMIN_PASSWORD" ]; then
        sed -i.bak "s|#\?ADMIN_PASSWORD=.*|ADMIN_PASSWORD=$ADMIN_PASSWORD|" .env
        print_success "Admin password configured (username: admin)"
    else
        print_info "Skipping — a random password will be shown in the server logs on first run"
    fi
    echo ""

    print_info "The following integrations are optional - skip any you don't need"
    echo ""

    # GitHub Token (optional - only needed for GitHub VCS/trigger)
    read -p "GitHub Token (for GitHub VCS/trigger, press Enter to skip): " GITHUB_TOKEN
    if [ -n "$GITHUB_TOKEN" ]; then
        sed -i.bak "s|GITHUB_TOKEN=.*|GITHUB_TOKEN=$GITHUB_TOKEN|" .env
        print_success "GitHub Token configured"

        # GitHub Webhook Secret (only generate if GitHub token was provided)
        print_info "Generating GitHub webhook secret..."
        WEBHOOK_SECRET=$(openssl rand -hex 32)
        sed -i.bak "s|GITHUB_WEBHOOK_SECRET=.*|GITHUB_WEBHOOK_SECRET=$WEBHOOK_SECRET|" .env
        print_success "GitHub webhook secret generated: $WEBHOOK_SECRET"
        print_warning "Save this secret - you'll need it when configuring GitHub webhooks"
    else
        print_info "Skipping GitHub configuration"
    fi

    # Username (for Docker volume mounting)
    CURRENT_USER=$(whoami)
    sed -i.bak "s|USER=.*|USER=$CURRENT_USER|" .env
    sed -i.bak "s|HOST_USER=.*|HOST_USER=$CURRENT_USER|" .env
    print_success "User configured: $CURRENT_USER"

    # Optional: Sentry
    read -p "Sentry Auth Token (optional, press Enter to skip): " SENTRY_TOKEN
    if [ -n "$SENTRY_TOKEN" ]; then
        sed -i.bak "s|SENTRY_AUTH_TOKEN=.*|SENTRY_AUTH_TOKEN=$SENTRY_TOKEN|" .env
        read -p "Sentry Organization: " SENTRY_ORG
        sed -i.bak "s|SENTRY_ORG=.*|SENTRY_ORG=$SENTRY_ORG|" .env
        print_success "Sentry configured"
    fi

    # Optional: CircleCI
    read -p "CircleCI Token (optional, press Enter to skip): " CIRCLECI_TOKEN
    if [ -n "$CIRCLECI_TOKEN" ]; then
        sed -i.bak "s|CIRCLECI_TOKEN=.*|CIRCLECI_TOKEN=$CIRCLECI_TOKEN|" .env
        print_success "CircleCI configured"
    fi

    # Remove backup file
    rm -f .env.bak

    print_success "Environment file configured"
    print_info "You can edit .env file later to add more configuration"
}

# Setup Docker network
setup_docker() {
    print_header "Setting Up Docker"

    # Create Docker network if it doesn't exist
    NETWORK_NAME="discharge_internal"
    if docker network ls | grep -q "$NETWORK_NAME"; then
        print_success "Docker network '$NETWORK_NAME' already exists"
    else
        docker network create "$NETWORK_NAME" 2>/dev/null || true
        print_success "Created Docker network '$NETWORK_NAME'"
    fi
}

# Setup Redis
setup_redis() {
    print_header "Setting Up Redis"

    # Check if Redis is already running
    if docker ps | grep -q redis; then
        print_success "Redis is already running"
        return
    fi

    # Check if docker-compose.yml exists
    if [ ! -f "docker-compose.yml" ]; then
        print_warning "docker-compose.yml not found"
        print_info "You'll need to start Redis manually or create a docker-compose.yml"
        return
    fi

    # Start Redis
    print_info "Starting Redis with Docker Compose..."
    docker compose up -d redis

    # Wait for Redis to be ready
    print_info "Waiting for Redis to be ready..."
    for i in {1..30}; do
        if docker compose exec -T redis redis-cli ping >/dev/null 2>&1; then
            print_success "Redis is ready"
            return
        fi
        sleep 1
    done

    print_warning "Redis may not be ready yet, continuing anyway..."
}

# Install Node dependencies
install_node_dependencies() {
    print_header "Installing Node Dependencies"

    if [ -d "node_modules" ]; then
        print_info "node_modules exists, updating dependencies..."
        npm ci
    else
        print_info "Installing dependencies..."
        npm install
    fi

    # Build workspace packages
    print_info "Building workspace packages..."
    npm run build:packages

    print_success "Dependencies installed and packages built"
}

# Build Docker images
build_docker_images() {
    print_header "Building Docker Images"

    if [ ! -f "docker-compose.yml" ]; then
        print_warning "docker-compose.yml not found, skipping Docker image build"
        return
    fi

    print_info "Building agent runner Docker image..."
    npm run dev:setup 2>/dev/null || {
        print_warning "Docker image build failed (may need docker-compose.yml updates)"
        print_info "You can build later with: npm run dev:setup"
    }

    print_success "Docker images built"
}

# Verify Claude CLI authentication
verify_claude_auth() {
    print_header "Verifying Claude CLI Authentication"

    if ! command_exists claude; then
        print_warning "Claude CLI not installed, skipping authentication check"
        return
    fi

    # Check if Claude CLI is authenticated
    if claude auth status >/dev/null 2>&1; then
        print_success "Claude CLI is authenticated"
    else
        print_warning "Claude CLI is not authenticated"
        print_info "Please run: claude auth"
        print_info "This will open a browser to authenticate with your Anthropic account"
        echo ""
        read -p "Do you want to authenticate now? (y/N): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            claude auth
            if [ $? -eq 0 ]; then
                print_success "Claude CLI authenticated successfully"
            else
                print_error "Authentication failed"
                print_info "You can authenticate later by running: claude auth"
            fi
        else
            print_info "You can authenticate later by running: claude auth"
        fi
    fi
}

# Install Discharge CLI
install_discharge_cli() {
    print_header "Discharge CLI"

    print_info "The Discharge CLI lets you submit AI tasks from any project."
    echo ""
    read -p "Install the CLI globally? (Y/n): " -n 1 -r
    echo

    if [[ $REPLY =~ ^[Nn]$ ]]; then
        print_info "Skipping CLI install"
        print_info "You can install later with: npm link -w packages/cli"
        return
    fi

    print_info "Linking Discharge CLI..."
    cd packages/cli
    npx tsc 2>/dev/null || true
    cd ../..
    npm link -w packages/cli 2>/dev/null || {
        print_warning "npm link failed, trying alternative..."
        npm install -g ./packages/cli 2>/dev/null || {
            print_warning "Global install failed"
            print_info "You can run it locally with: npx discharge"
            return
        }
    }

    if command_exists discharge; then
        print_success "Discharge CLI installed"
        print_info "Run 'discharge init' from any project to connect it"
    else
        print_info "CLI installed but may need a new terminal session"
    fi
}

# Run tests
run_tests() {
    print_header "Running Tests"

    print_info "Running unit tests..."
    if npm run test:unit 2>&1 | tee /tmp/discharge-test-output.txt; then
        print_success "All tests passed"
    else
        print_warning "Some tests failed"
        print_info "Check the output above for details"
        print_info "You can continue setup, but please fix failing tests"
        echo ""
        read -p "Do you want to continue? (Y/n): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Nn]$ ]]; then
            exit 1
        fi
    fi
}

# Run main function
main
