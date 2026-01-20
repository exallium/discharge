#!/bin/bash
# agent-shell.sh - Drop into a Claude Code agent container for debugging
#
# This sets up a temporary workspace with MCP config and drops you into
# the same environment the agent sees during job execution.

set -e

# Create temp workspace
WORKSPACE=$(mktemp -d)
CLAUDE_DIR="$WORKSPACE/.claude-config"
CLAUDE_JSON="$WORKSPACE/.claude.json"
mkdir -p "$CLAUDE_DIR/projects" "$CLAUDE_DIR/debug" "$CLAUDE_DIR/statsig"

# Project ID for MCP (use argument or default)
PROJECT_ID="${1:-test-project}"

# Create .claude.json with MCP config (at workspace root, will be mounted to ~/.claude.json)
cat > "$CLAUDE_JSON" << EOF
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
echo "Claude dir (mounted to ~/.claude/): $CLAUDE_DIR"
echo "Claude config (mounted to ~/.claude.json): $CLAUDE_JSON"
echo "MCP URL: http://mcp:3001/sse?projectId=${PROJECT_ID}"
echo ""
echo "Useful commands inside container:"
echo "  cat ~/.claude.json           # Check MCP config"
echo "  ls ~/.claude/                # Check Claude directory"
echo "  curl http://mcp:3001/health  # Test MCP connectivity"
echo "  claude mcp list              # List configured MCP servers"
echo "  claude --help                # Claude CLI help"
echo ""
echo "Press Ctrl+D or type 'exit' to leave"
echo "==="
echo ""

# Run container interactively
# Note: Two separate mounts for Claude Code config:
#   - .claude-config/ -> ~/.claude/ (internal state dirs)
#   - .claude.json -> ~/.claude.json (config file with MCP servers)
docker run --rm -it \
  --name claude-debug-shell \
  --network ${DOCKER_NETWORK:-ai-bug-fixer_internal} \
  -v "$WORKSPACE:/workspace" \
  -v "$CLAUDE_DIR:/home/agent/.claude" \
  -v "$CLAUDE_JSON:/home/agent/.claude.json" \
  --entrypoint /bin/bash \
  agent-runner-claude:latest

# Cleanup
rm -rf "$WORKSPACE"
echo "Cleaned up workspace"
