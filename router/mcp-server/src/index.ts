#!/usr/bin/env node
/**
 * AI Bug Fixer MCP Server
 *
 * A read-only Model Context Protocol (MCP) server that provides tools
 * for accessing bug tracking and monitoring systems (Sentry, etc.).
 *
 * This server runs as a service alongside the router and worker,
 * providing Claude Code agents with access to external APIs.
 *
 * The server is designed to be pluggable - new tool providers can be
 * added by implementing the McpTool interface and registering them.
 *
 * Environment variables:
 * - DATABASE_URL: PostgreSQL connection string
 * - DB_ENCRYPTION_KEY: Key for decrypting secrets from database
 * - MCP_ENABLED_TOOLS: Comma-separated list of tool prefixes to enable (default: all)
 * - MCP_PORT: Port for SSE transport (default: 3001)
 * - MCP_TRANSPORT: Transport type - 'sse' or 'stdio' (default: sse)
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createServer } from 'http';
import { URL } from 'url';
import { closePool } from './db.js';
import { sentryTools } from './tools/sentry.js';
import type { McpTool } from './types.js';

/**
 * Current project context for the session
 * Set when a client connects with a projectId parameter
 */
let currentProjectId: string | null = null;

/**
 * Get the current project ID for tool calls
 */
export function getCurrentProjectId(): string | null {
  return currentProjectId;
}

/**
 * Tool registry for pluggable tool providers
 *
 * To add a new tool provider:
 * 1. Create a new file in ./tools/ implementing McpTool[]
 * 2. Import and spread into this array
 * 3. Tool names should be prefixed with the provider name (e.g., sentry_get_issue)
 */
const toolRegistry: McpTool[] = [
  // Sentry tools for error tracking
  ...sentryTools,

  // Future: Add more tool providers here
  // ...githubTools,
  // ...circleciTools,
  // ...datadogTools,
];

/**
 * Filter tools based on MCP_ENABLED_TOOLS environment variable
 * Format: comma-separated list of tool name prefixes (e.g., "sentry,github")
 * If not set, all tools are enabled
 */
function getEnabledTools(): McpTool[] {
  const enabledPrefixes = process.env.MCP_ENABLED_TOOLS;

  if (!enabledPrefixes) {
    return toolRegistry;
  }

  const prefixes = enabledPrefixes.split(',').map((p) => p.trim().toLowerCase());

  return toolRegistry.filter((tool) => {
    const toolPrefix = tool.name.split('_')[0].toLowerCase();
    return prefixes.includes(toolPrefix);
  });
}

// Get enabled tools
const enabledTools = getEnabledTools();

// Create the server
const server = new Server(
  {
    name: 'ai-bug-fixer-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: enabledTools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // Find the tool
  const tool = enabledTools.find((t) => t.name === name);
  if (!tool) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ error: `Unknown tool: ${name}` }),
        },
      ],
      isError: true,
    };
  }

  try {
    // Call the tool handler with the arguments as a record
    const result = await tool.handler(args as Record<string, unknown>);

    return {
      content: [
        {
          type: 'text',
          text: result,
        },
      ],
    };
  } catch (error) {
    console.error(`[MCP] Tool ${name} failed:`, error);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
          }),
        },
      ],
      isError: true,
    };
  }
});

// Graceful shutdown
async function shutdown() {
  console.error('[MCP] Shutting down...');
  await closePool();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Start the server
async function main() {
  const transportType = process.env.MCP_TRANSPORT || 'sse';
  const port = parseInt(process.env.MCP_PORT || '3001', 10);

  console.error('[MCP] AI Bug Fixer MCP Server starting...');
  console.error(
    `[MCP] Enabled tools (${enabledTools.length}/${toolRegistry.length}):`,
    enabledTools.map((t) => t.name).join(', ')
  );

  if (transportType === 'stdio') {
    // Stdio transport for local/subprocess usage
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('[MCP] Server running on stdio');
  } else {
    // SSE transport for network access
    const httpServer = createServer(async (req, res) => {
      // Health check endpoint
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', tools: enabledTools.length }));
        return;
      }

      // SSE endpoint for MCP
      if (req.url?.startsWith('/sse') || req.url === '/') {
        // Extract projectId from query string
        const urlObj = new URL(req.url || '/', `http://${req.headers.host}`);
        const projectId = urlObj.searchParams.get('projectId');

        if (projectId) {
          currentProjectId = projectId;
          console.error(`[MCP] New SSE connection from ${req.socket.remoteAddress} for project: ${projectId}`);
        } else {
          console.error(`[MCP] New SSE connection from ${req.socket.remoteAddress} (no projectId)`);
        }

        const transport = new SSEServerTransport('/message', res);
        await server.connect(transport);
        return;
      }

      // Message endpoint for SSE transport
      if (req.url === '/message' && req.method === 'POST') {
        // SSEServerTransport handles this internally
        return;
      }

      res.writeHead(404);
      res.end('Not found');
    });

    httpServer.listen(port, '0.0.0.0', () => {
      console.error(`[MCP] Server running on http://0.0.0.0:${port}`);
      console.error(`[MCP] SSE endpoint: http://mcp:${port}/sse`);
      console.error(`[MCP] Health check: http://mcp:${port}/health`);
    });
  }
}

main().catch((error) => {
  console.error('[MCP] Failed to start server:', error);
  process.exit(1);
});
