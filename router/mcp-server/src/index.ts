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
import { githubTools } from './tools/github.js';
import type { McpTool } from './types.js';

/**
 * Current project context for the session
 * Set when a client connects with a projectId parameter
 */
let currentProjectId: string | null = null;

/**
 * Active SSE transports keyed by sessionId
 * Used to route /message POST requests to the correct transport
 */
const activeTransports = new Map<string, SSEServerTransport>();

/**
 * Get the current project ID for tool calls
 */
export function getCurrentProjectId(): string | null {
  return currentProjectId;
}

/**
 * Tool call log entry
 */
interface ToolCallLog {
  timestamp: string;
  projectId: string;
  tool: string;
  args: Record<string, unknown>;
  success: boolean;
  durationMs: number;
  error?: string;
}

/**
 * In-memory tool call log (limited to last 1000 entries)
 * Keyed by projectId for easy lookup
 */
const toolCallLogs = new Map<string, ToolCallLog[]>();
const MAX_LOGS_PER_PROJECT = 100;

/**
 * Log a tool call
 */
function logToolCall(log: ToolCallLog): void {
  const projectLogs = toolCallLogs.get(log.projectId) || [];
  projectLogs.push(log);

  // Keep only the most recent logs
  if (projectLogs.length > MAX_LOGS_PER_PROJECT) {
    projectLogs.shift();
  }

  toolCallLogs.set(log.projectId, projectLogs);

  // Also log to console for docker logs
  console.error(`[MCP] Tool call: ${log.tool} (project: ${log.projectId}, success: ${log.success}, ${log.durationMs}ms)`);
}

/**
 * Get tool call logs for a project since a given time
 */
function getToolCallLogs(projectId: string, since?: string): ToolCallLog[] {
  const projectLogs = toolCallLogs.get(projectId) || [];

  if (!since) {
    return projectLogs;
  }

  const sinceTime = new Date(since).getTime();
  return projectLogs.filter(log => new Date(log.timestamp).getTime() >= sinceTime);
}

/**
 * Clear tool call logs for a project
 */
function clearToolCallLogs(projectId: string): void {
  toolCallLogs.delete(projectId);
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

  // GitHub tools for issues and PRs
  ...githubTools,

  // Future: Add more tool providers here
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
  const startTime = Date.now();
  const projectId = currentProjectId || 'unknown';

  // Find the tool
  const tool = enabledTools.find((t) => t.name === name);
  if (!tool) {
    logToolCall({
      timestamp: new Date().toISOString(),
      projectId,
      tool: name,
      args: (args || {}) as Record<string, unknown>,
      success: false,
      durationMs: Date.now() - startTime,
      error: `Unknown tool: ${name}`,
    });

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

    logToolCall({
      timestamp: new Date().toISOString(),
      projectId,
      tool: name,
      args: (args || {}) as Record<string, unknown>,
      success: true,
      durationMs: Date.now() - startTime,
    });

    return {
      content: [
        {
          type: 'text',
          text: result,
        },
      ],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[MCP] Tool ${name} failed:`, error);

    logToolCall({
      timestamp: new Date().toISOString(),
      projectId,
      tool: name,
      args: (args || {}) as Record<string, unknown>,
      success: false,
      durationMs: Date.now() - startTime,
      error: errorMessage,
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: errorMessage,
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

      // Tool call logs endpoint
      // GET /logs?projectId=xxx&since=2024-01-01T00:00:00Z
      if (req.url?.startsWith('/logs') && req.method === 'GET') {
        const urlObj = new URL(req.url, `http://${req.headers.host}`);
        const projectId = urlObj.searchParams.get('projectId');
        const since = urlObj.searchParams.get('since') || undefined;

        if (!projectId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'projectId is required' }));
          return;
        }

        const logs = getToolCallLogs(projectId, since);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ logs }));
        return;
      }

      // Clear logs endpoint (for cleanup after conversation)
      // DELETE /logs?projectId=xxx
      if (req.url?.startsWith('/logs') && req.method === 'DELETE') {
        const urlObj = new URL(req.url, `http://${req.headers.host}`);
        const projectId = urlObj.searchParams.get('projectId');

        if (!projectId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'projectId is required' }));
          return;
        }

        clearToolCallLogs(projectId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ cleared: true }));
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

        // Store transport for message routing
        activeTransports.set(transport.sessionId, transport);
        console.error(`[MCP] Registered transport with sessionId: ${transport.sessionId}`);

        // Cleanup on connection close
        res.on('close', () => {
          activeTransports.delete(transport.sessionId);
          console.error(`[MCP] Removed transport with sessionId: ${transport.sessionId}`);
        });

        await server.connect(transport);
        return;
      }

      // Message endpoint for SSE transport
      if (req.url?.startsWith('/message') && req.method === 'POST') {
        const urlObj = new URL(req.url, `http://${req.headers.host}`);
        const sessionId = urlObj.searchParams.get('sessionId');

        if (!sessionId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'sessionId is required' }));
          return;
        }

        const transport = activeTransports.get(sessionId);
        if (!transport) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Session not found' }));
          return;
        }

        await transport.handlePostMessage(req, res);
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
