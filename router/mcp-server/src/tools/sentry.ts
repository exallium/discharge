/**
 * Sentry read-only MCP tools
 *
 * Provides tools to fetch Sentry issue details, events, and stack traces.
 * All operations are read-only.
 */

import { z } from 'zod';
import { getSecret } from '../secrets.js';
import { getProject } from '../db.js';
import { getCurrentProjectId } from '../index.js';
import type { McpTool } from '../types.js';

// Input schemas for tools
// Note: projectId is optional - if not provided, uses the session's project ID
export const GetIssueSchema = z.object({
  issueId: z.string().describe('The Sentry issue ID'),
  projectId: z.string().optional().describe('The Discharge project ID (optional - uses session project if not provided)'),
});

export const GetIssueEventsSchema = z.object({
  issueId: z.string().describe('The Sentry issue ID'),
  projectId: z.string().optional().describe('The Discharge project ID (optional - uses session project if not provided)'),
  limit: z.number().optional().default(10).describe('Maximum number of events to fetch'),
});

export const GetEventDetailsSchema = z.object({
  issueId: z.string().describe('The Sentry issue ID'),
  eventId: z.string().describe('The specific event ID'),
  projectId: z.string().optional().describe('The Discharge project ID (optional - uses session project if not provided)'),
});

export const SearchIssuesSchema = z.object({
  projectId: z.string().optional().describe('The Discharge project ID (optional - uses session project if not provided)'),
  query: z.string().optional().describe('Search query (Sentry search syntax)'),
  status: z.enum(['resolved', 'unresolved', 'ignored']).optional().describe('Filter by status'),
  limit: z.number().optional().default(25).describe('Maximum number of issues to return'),
});

/**
 * Resolve project ID from params or session
 */
function resolveProjectId(providedProjectId?: string): string | null {
  return providedProjectId || getCurrentProjectId();
}

/**
 * Get Sentry configuration for a project
 */
async function getSentryConfig(providedProjectId?: string): Promise<{
  authToken: string;
  baseUrl: string;
  organization: string;
  projectSlug: string;
} | null> {
  const projectId = resolveProjectId(providedProjectId);
  if (!projectId) {
    console.error('[MCP/Sentry] No project ID available (not in params or session)');
    return null;
  }

  const project = await getProject(projectId);
  if (!project) {
    console.error(`[MCP/Sentry] Project not found: ${projectId}`);
    return null;
  }

  const triggers = project.triggers as Record<string, unknown>;
  const sentryConfig = triggers?.sentry as {
    enabled?: boolean;
    organization?: string;
    projectSlug?: string;
    instanceUrl?: string;
  } | undefined;

  if (!sentryConfig?.enabled) {
    console.error(`[MCP/Sentry] Sentry not enabled for project: ${projectId}`);
    return null;
  }

  const authToken = await getSecret('sentry', 'auth_token', projectId);
  if (!authToken) {
    console.error(`[MCP/Sentry] Auth token not found for project: ${projectId}`);
    return null;
  }

  return {
    authToken,
    baseUrl: sentryConfig.instanceUrl || 'https://sentry.io',
    organization: sentryConfig.organization || '',
    projectSlug: sentryConfig.projectSlug || '',
  };
}

/**
 * Make a Sentry API request
 */
async function sentryFetch<T>(
  config: { authToken: string; baseUrl: string },
  path: string
): Promise<T> {
  const url = `${config.baseUrl}/api/0${path}`;
  console.error(`[MCP/Sentry] Fetching: ${url}`);

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${config.authToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Sentry API error: ${response.status} ${response.statusText} - ${text}`);
  }

  return response.json() as Promise<T>;
}

// Tool implementations

/**
 * Get full Sentry issue details
 */
export async function getIssue(params: z.infer<typeof GetIssueSchema>): Promise<string> {
  const config = await getSentryConfig(params.projectId);
  if (!config) {
    return JSON.stringify({ error: 'Sentry not configured for this project' });
  }

  try {
    const issue = await sentryFetch(config, `/issues/${params.issueId}/`);
    return JSON.stringify(issue, null, 2);
  } catch (error) {
    return JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Get events (occurrences) for a Sentry issue
 */
export async function getIssueEvents(
  params: z.infer<typeof GetIssueEventsSchema>
): Promise<string> {
  const config = await getSentryConfig(params.projectId);
  if (!config) {
    return JSON.stringify({ error: 'Sentry not configured for this project' });
  }

  try {
    const events = await sentryFetch<unknown[]>(
      config,
      `/issues/${params.issueId}/events/?limit=${params.limit}`
    );

    // Simplify event data for readability
    const simplified = events.map((event: unknown) => {
      const e = event as Record<string, unknown>;
      return {
        eventID: e.eventID,
        dateCreated: e.dateCreated,
        message: e.message || e.title,
        platform: e.platform,
        // Include entries if present (contains exception/stacktrace)
        entries: e.entries,
      };
    });

    return JSON.stringify(simplified, null, 2);
  } catch (error) {
    return JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Get full details for a specific event
 */
export async function getEventDetails(
  params: z.infer<typeof GetEventDetailsSchema>
): Promise<string> {
  const config = await getSentryConfig(params.projectId);
  if (!config) {
    return JSON.stringify({ error: 'Sentry not configured for this project' });
  }

  try {
    const event = await sentryFetch(
      config,
      `/issues/${params.issueId}/events/${params.eventId}/`
    );
    return JSON.stringify(event, null, 2);
  } catch (error) {
    return JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Get the latest event for an issue with full stack trace
 */
export async function getLatestEvent(params: z.infer<typeof GetIssueSchema>): Promise<string> {
  const config = await getSentryConfig(params.projectId);
  if (!config) {
    return JSON.stringify({ error: 'Sentry not configured for this project' });
  }

  try {
    // First get the latest event ID
    const events = await sentryFetch<unknown[]>(
      config,
      `/issues/${params.issueId}/events/?limit=1`
    );

    if (!events || events.length === 0) {
      return JSON.stringify({ error: 'No events found for this issue' });
    }

    const latestEventId = (events[0] as Record<string, unknown>).eventID as string;

    // Then get full event details
    const event = await sentryFetch(
      config,
      `/issues/${params.issueId}/events/${latestEventId}/`
    );

    return JSON.stringify(event, null, 2);
  } catch (error) {
    return JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Search issues in a Sentry project
 */
export async function searchIssues(params: z.infer<typeof SearchIssuesSchema>): Promise<string> {
  const config = await getSentryConfig(params.projectId);
  if (!config) {
    return JSON.stringify({ error: 'Sentry not configured for this project' });
  }

  if (!config.organization || !config.projectSlug) {
    return JSON.stringify({
      error: 'Sentry organization and project slug must be configured',
    });
  }

  try {
    // Build query parameters
    const queryParams = new URLSearchParams();
    queryParams.set('limit', String(params.limit));

    if (params.query) {
      queryParams.set('query', params.query);
    }
    if (params.status) {
      queryParams.set('query', `${params.query || ''} is:${params.status}`.trim());
    }

    const issues = await sentryFetch<unknown[]>(
      config,
      `/projects/${config.organization}/${config.projectSlug}/issues/?${queryParams}`
    );

    // Simplify for readability
    const simplified = issues.map((issue: unknown) => {
      const i = issue as Record<string, unknown>;
      return {
        id: i.id,
        shortId: i.shortId,
        title: i.title,
        culprit: i.culprit,
        level: i.level,
        status: i.status,
        count: i.count,
        userCount: i.userCount,
        firstSeen: i.firstSeen,
        lastSeen: i.lastSeen,
        permalink: i.permalink,
      };
    });

    return JSON.stringify(simplified, null, 2);
  } catch (error) {
    return JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Sentry tool definitions for MCP server
 *
 * All tools are read-only and prefixed with 'sentry_'.
 * Project ID is optional - if not provided, uses the session's project ID.
 */
export const sentryTools: McpTool[] = [
  {
    name: 'sentry_get_issue',
    description:
      'Get full details for a Sentry issue including metadata, tags, and context. ' +
      'Use this to understand the error being investigated.',
    inputSchema: {
      type: 'object',
      properties: {
        issueId: { type: 'string', description: 'The Sentry issue ID' },
        projectId: { type: 'string', description: 'Optional: Discharge project ID (uses session project if not provided)' },
      },
      required: ['issueId'],
    },
    handler: (args) =>
      getIssue({
        issueId: args.issueId as string,
        projectId: args.projectId as string | undefined,
      }),
  },
  {
    name: 'sentry_get_events',
    description:
      'Get recent events (occurrences) for a Sentry issue. ' +
      'Each event includes when it happened and basic context.',
    inputSchema: {
      type: 'object',
      properties: {
        issueId: { type: 'string', description: 'The Sentry issue ID' },
        projectId: { type: 'string', description: 'Optional: Discharge project ID (uses session project if not provided)' },
        limit: { type: 'number', description: 'Max events to return (default 10)' },
      },
      required: ['issueId'],
    },
    handler: (args) =>
      getIssueEvents({
        issueId: args.issueId as string,
        projectId: args.projectId as string | undefined,
        limit: (args.limit as number) ?? 10,
      }),
  },
  {
    name: 'sentry_get_event_details',
    description:
      'Get complete details for a specific event including full stack trace, ' +
      'breadcrumbs, and request context. Use after sentry_get_events to drill down.',
    inputSchema: {
      type: 'object',
      properties: {
        issueId: { type: 'string', description: 'The Sentry issue ID' },
        eventId: { type: 'string', description: 'The specific event ID' },
        projectId: { type: 'string', description: 'Optional: Discharge project ID (uses session project if not provided)' },
      },
      required: ['issueId', 'eventId'],
    },
    handler: (args) =>
      getEventDetails({
        issueId: args.issueId as string,
        eventId: args.eventId as string,
        projectId: args.projectId as string | undefined,
      }),
  },
  {
    name: 'sentry_get_latest_event',
    description:
      'Get the most recent event for an issue with full stack trace and breadcrumbs. ' +
      'Shortcut for getting the latest occurrence without knowing the event ID.',
    inputSchema: {
      type: 'object',
      properties: {
        issueId: { type: 'string', description: 'The Sentry issue ID' },
        projectId: { type: 'string', description: 'Optional: Discharge project ID (uses session project if not provided)' },
      },
      required: ['issueId'],
    },
    handler: (args) =>
      getLatestEvent({
        issueId: args.issueId as string,
        projectId: args.projectId as string | undefined,
      }),
  },
  {
    name: 'sentry_search_issues',
    description:
      'Search for issues in the configured Sentry project. ' +
      'Supports Sentry search syntax for filtering by various criteria.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Optional: Discharge project ID (uses session project if not provided)' },
        query: { type: 'string', description: 'Search query (Sentry search syntax)' },
        status: {
          type: 'string',
          enum: ['resolved', 'unresolved', 'ignored'],
          description: 'Filter by status',
        },
        limit: { type: 'number', description: 'Max issues to return (default 25)' },
      },
    },
    handler: (args) =>
      searchIssues({
        projectId: args.projectId as string | undefined,
        query: args.query as string | undefined,
        status: args.status as 'resolved' | 'unresolved' | 'ignored' | undefined,
        limit: (args.limit as number) ?? 25,
      }),
  },
];
