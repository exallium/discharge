#!/bin/bash

# =============================================================================
# AI Bug Fixer - Automated Setup Script
# =============================================================================
# This script helps you set up the AI Bug Fixer environment
# Run with: bash setup.sh
# =============================================================================

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper functions
print_header() {
    echo -e "\n${BLUE}========================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}========================================${NC}\n"
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
    print_header "AI Bug Fixer Setup"

    echo "This script will guide you through setting up the AI Bug Fixer."
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

    # Step 8: Run tests
    run_tests

    # Done!
    print_header "Setup Complete!"
    print_success "AI Bug Fixer is ready to use"
    echo ""
    print_info "Next steps:"
    echo "  1. Review and update .env file with your credentials"
    echo "  2. Configure your projects in router/src/config/projects.ts"
    echo "  3. Set up webhooks in GitHub/Sentry/CircleCI (see plugin READMEs)"
    echo "  4. Start the server: npm start"
    echo ""
    print_info "Useful commands:"
    echo "  npm start              - Start the server"
    echo "  npm test               - Run tests"
    echo "  npm run dev            - Start in development mode"
    echo "  docker-compose up      - Start Redis and supporting services"
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

        # Check version (need >= 18)
        NODE_MAJOR=$(echo $NODE_VERSION | cut -d'v' -f2 | cut -d'.' -f1)
        if [ "$NODE_MAJOR" -lt 18 ]; then
            print_error "Node.js 18 or higher is required (you have $NODE_VERSION)"
            missing_deps+=("node>=18")
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

    # Check Claude CLI (optional but recommended)
    if command_exists claude; then
        CLAUDE_VERSION=$(claude --version 2>/dev/null || echo "unknown")
        print_success "Claude Code CLI installed ($CLAUDE_VERSION)"
    else
        print_warning "Claude Code CLI not found"
        print_info "Claude CLI is required for the AI Bug Fixer to work"
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

    # Copy example file
    cp .env.example .env
    print_success "Created .env file from template"

    # Prompt for required values
    print_info "Let's configure your environment variables"
    echo ""

    # GitHub Token
    read -p "GitHub Token (required): " GITHUB_TOKEN
    if [ -n "$GITHUB_TOKEN" ]; then
        sed -i.bak "s|GITHUB_TOKEN=.*|GITHUB_TOKEN=$GITHUB_TOKEN|" .env
        print_success "GitHub Token configured"
    fi

    # GitHub Webhook Secret
    print_info "Generating GitHub webhook secret..."
    WEBHOOK_SECRET=$(openssl rand -hex 32)
    sed -i.bak "s|GITHUB_WEBHOOK_SECRET=.*|GITHUB_WEBHOOK_SECRET=$WEBHOOK_SECRET|" .env
    print_success "GitHub webhook secret generated: $WEBHOOK_SECRET"
    print_warning "Save this secret - you'll need it when configuring GitHub webhooks"

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
    NETWORK_NAME="ai-bug-fixer_internal"
    if docker network ls | grep -q "$NETWORK_NAME"; then
        print_success "Docker network '$NETWORK_NAME' already exists"
    else
        docker network create "$NETWORK_NAME"
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
    docker-compose up -d redis

    # Wait for Redis to be ready
    print_info "Waiting for Redis to be ready..."
    for i in {1..30}; do
        if docker-compose exec -T redis redis-cli ping >/dev/null 2>&1; then
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

    cd router

    if [ -d "node_modules" ]; then
        print_info "node_modules exists, updating dependencies..."
        npm ci
    else
        print_info "Installing dependencies..."
        npm install
    fi

    print_success "Dependencies installed"
    cd ..
}

# Build Docker images
build_docker_images() {
    print_header "Building Docker Images"

    # Check if Dockerfile for runner exists
    if [ ! -f "runner/Dockerfile" ]; then
        print_warning "runner/Dockerfile not found"
        print_info "Skipping Docker image build"
        return
    fi

    print_info "Building claude-runner image..."
    docker build -t claude-runner:latest runner/

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

# Run tests
run_tests() {
    print_header "Running Tests"

    cd router

    print_info "Running unit tests..."
    if npm test 2>&1 | tee /tmp/test-output.txt; then
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

    cd ..
}

# Run main function
main
