/**
 * MCP Server utilities
 *
 * Provides health checks and configuration for the MCP server connection.
 */

import { getErrorMessage } from '../types/errors';

/**
 * Whether MCP server is enabled
 */
export const MCP_ENABLED = process.env.ENABLE_MCP_SERVER !== 'false';

/**
 * MCP server URL (internal docker network)
 */
export const MCP_SERVER_URL = process.env.MCP_SERVER_URL || 'http://mcp:3001';

/**
 * Result of MCP health check
 */
export interface MCPHealthResult {
  available: boolean;
  toolCount?: number;
  error?: string;
}

/**
 * Check if the MCP server is available and responding
 *
 * @returns Health check result with availability status
 */
export async function checkMCPHealth(): Promise<MCPHealthResult> {
  if (!MCP_ENABLED) {
    return {
      available: false,
      error: 'MCP server is disabled (ENABLE_MCP_SERVER=false)',
    };
  }

  try {
    const response = await fetch(`${MCP_SERVER_URL}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000), // 5 second timeout
    });

    if (!response.ok) {
      return {
        available: false,
        error: `MCP server returned ${response.status}: ${response.statusText}`,
      };
    }

    const data = await response.json() as { status: string; tools: number };

    if (data.status !== 'ok') {
      return {
        available: false,
        error: `MCP server status: ${data.status}`,
      };
    }

    return {
      available: true,
      toolCount: data.tools,
    };
  } catch (error) {
    return {
      available: false,
      error: `Failed to connect to MCP server at ${MCP_SERVER_URL}: ${getErrorMessage(error)}`,
    };
  }
}

/**
 * Verify MCP is available for Sentry investigations
 *
 * @throws Error if MCP is not available
 */
export async function requireMCPForSentry(): Promise<void> {
  const health = await checkMCPHealth();

  if (!health.available) {
    throw new Error(
      `MCP server is required for Sentry investigations but is not available. ` +
      `${health.error || 'Unknown error'}. ` +
      `Please ensure the MCP service is running and accessible.`
    );
  }

  console.log(`[MCP] Health check passed: ${health.toolCount} tools available`);
}

/**
 * MCP tool call log entry
 */
export interface MCPToolCallLog {
  timestamp: string;
  projectId: string;
  tool: string;
  args: Record<string, unknown>;
  success: boolean;
  durationMs: number;
  error?: string;
}

/**
 * Fetch MCP tool call logs for a project
 *
 * @param projectId - Project ID to get logs for
 * @param since - Optional ISO timestamp to filter logs from
 * @returns Array of tool call logs
 */
export async function getMCPToolCallLogs(
  projectId: string,
  since?: string
): Promise<MCPToolCallLog[]> {
  if (!MCP_ENABLED) {
    return [];
  }

  try {
    const url = new URL(`${MCP_SERVER_URL}/logs`);
    url.searchParams.set('projectId', projectId);
    if (since) {
      url.searchParams.set('since', since);
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      console.warn(`[MCP] Failed to fetch tool logs: ${response.status}`);
      return [];
    }

    const data = await response.json() as { logs: MCPToolCallLog[] };
    return data.logs || [];
  } catch (error) {
    console.warn(`[MCP] Error fetching tool logs: ${getErrorMessage(error)}`);
    return [];
  }
}

/**
 * Clear MCP tool call logs for a project
 *
 * @param projectId - Project ID to clear logs for
 */
export async function clearMCPToolCallLogs(projectId: string): Promise<void> {
  if (!MCP_ENABLED) {
    return;
  }

  try {
    const url = new URL(`${MCP_SERVER_URL}/logs`);
    url.searchParams.set('projectId', projectId);

    await fetch(url.toString(), {
      method: 'DELETE',
      signal: AbortSignal.timeout(5000),
    });
  } catch (error) {
    console.warn(`[MCP] Error clearing tool logs: ${getErrorMessage(error)}`);
  }
}
