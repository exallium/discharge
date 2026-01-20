/**
 * Shared types for MCP server
 */

/**
 * MCP Tool definition interface
 *
 * Implement this interface to create new tool providers.
 * Each tool should be read-only and named with a provider prefix (e.g., sentry_get_issue).
 */
export interface McpTool {
  /** Tool name, should be prefixed with provider name (e.g., sentry_get_issue) */
  name: string;

  /** Human-readable description of what the tool does */
  description: string;

  /** JSON Schema for tool input */
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };

  /** Tool handler - receives parsed arguments, returns JSON string result */
  handler: (args: Record<string, unknown>) => Promise<string>;
}

/**
 * Tool provider interface for grouping related tools
 *
 * Optional interface for organizing tools by provider.
 */
export interface McpToolProvider {
  /** Provider identifier (e.g., 'sentry', 'github') */
  id: string;

  /** Human-readable provider name */
  name: string;

  /** List of tools provided */
  tools: McpTool[];

  /**
   * Check if provider is configured for a project
   * Used to show only relevant tools
   */
  isConfigured?: (projectId: string) => Promise<boolean>;
}
