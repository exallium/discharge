#!/bin/bash
#
# Claude Code OAuth Authentication Setup
#
# This script sets up OAuth credentials for Docker-based Claude Code execution.
# On macOS, Claude stores credentials in Keychain which isn't accessible from Docker.
# This script authenticates inside a Docker container where credentials are stored
# in a file that can be shared across all containers.
#

set -e

CREDS_DIR="${CLAUDE_CREDS_PATH:-$HOME/.claude-docker-creds}"
CREDS_FILE="$CREDS_DIR/.credentials.json"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

check_credentials() {
    if [ -f "$CREDS_FILE" ]; then
        # Check if file has valid OAuth content
        if grep -q "accessToken\|claudeAiOauth" "$CREDS_FILE" 2>/dev/null; then
            echo -e "${GREEN}✓ OAuth credentials found at $CREDS_FILE${NC}"
            return 0
        fi
    fi
    echo -e "${YELLOW}✗ No valid OAuth credentials found${NC}"
    return 1
}

# Handle --check flag
if [ "$1" == "--check" ]; then
    if check_credentials; then
        exit 0
    else
        echo -e "${YELLOW}Run 'npm run claude:auth' to set up credentials${NC}"
        exit 1
    fi
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Claude Code OAuth Setup for Docker"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check if credentials already exist
if check_credentials; then
    echo ""
    read -p "Credentials already exist. Re-authenticate? (y/N) " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Keeping existing credentials."
        exit 0
    fi
fi

# Create credentials directory
echo ""
echo "Creating credentials directory: $CREDS_DIR"
mkdir -p "$CREDS_DIR"

# Check if Docker is running
if ! docker info >/dev/null 2>&1; then
    echo -e "${RED}Error: Docker is not running. Please start Docker first.${NC}"
    exit 1
fi

# Check if agent-runner image exists
if ! docker images -q agent-runner-claude:latest | grep -q .; then
    echo -e "${YELLOW}Agent runner image not found. Building...${NC}"
    docker compose -f ../docker-compose.yml --profile build-only build agent-runner-claude
fi

echo ""
echo "Starting interactive Docker container for authentication..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Inside the container, run:"
echo -e "  ${GREEN}claude auth login${NC}"
echo ""
echo "Follow the prompts to authenticate, then type 'exit' to leave."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Run interactive container with credentials directory mounted
docker run -it --rm \
    -v "$CREDS_DIR:/home/agent/.claude" \
    --entrypoint /bin/bash \
    agent-runner-claude:latest

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Verify credentials were created
if check_credentials; then
    echo ""
    echo -e "${GREEN}Authentication successful!${NC}"
    echo "Credentials saved to: $CREDS_DIR"
    echo ""
    echo "These credentials will be used by all Claude Code Docker containers."
    echo "Re-run this script when credentials expire."
else
    echo ""
    echo -e "${RED}Authentication may have failed.${NC}"
    echo "No valid credentials found at $CREDS_FILE"
    echo ""
    echo "Please try again and make sure to run 'claude auth login' inside the container."
    exit 1
fi
