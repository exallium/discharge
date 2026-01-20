#!/bin/bash
# agent-shell.sh - Drop into a Claude Code agent container for debugging
#
# This sets up a temporary workspace with MCP config and drops you into
# the same environment the agent sees during job execution.

set -e

# Create temp workspace
WORKSPACE=$(mktemp -d)
CLAUDE_CONFIG="$WORKSPACE/.claude-config"
mkdir -p "$CLAUDE_CONFIG/projects" "$CLAUDE_CONFIG/debug" "$CLAUDE_CONFIG/statsig"

# Project ID for MCP (use argument or default)
PROJECT_ID="${1:-test-project}"

# Create .claude.json with MCP config
cat > "$CLAUDE_CONFIG/.claude.json" << EOF
{
  "hasCompletedOnboarding": true,
  "mcpServers": {
    "ai-bug-fixer": {
      "type": "sse",
      "url": "http://mcp:3001/sse?projectId=${PROJECT_ID}"
    }
  }
}
EOF

echo "=== Agent Shell ==="
echo "Workspace: $WORKSPACE"
echo "Claude config: $CLAUDE_CONFIG/.claude.json"
echo "MCP URL: http://mcp:3001/sse?projectId=${PROJECT_ID}"
echo ""
echo "Useful commands inside container:"
echo "  cat ~/.claude.json           # Check MCP config"
echo "  curl http://mcp:3001/health  # Test MCP connectivity"
echo "  claude mcp list              # List configured MCP servers"
echo "  claude --help                # Claude CLI help"
echo ""
echo "Press Ctrl+D or type 'exit' to leave"
echo "==="
echo ""

# Run container interactively
docker run --rm -it \
  --name claude-debug-shell \
  --network ${DOCKER_NETWORK:-ai-bug-fixer_internal} \
  -v "$WORKSPACE:/workspace" \
  -v "$CLAUDE_CONFIG:/home/agent/.claude" \
  --entrypoint /bin/bash \
  agent-runner-claude:latest

# Cleanup
rm -rf "$WORKSPACE"
echo "Cleaned up workspace"
