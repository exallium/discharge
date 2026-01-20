import crypto from 'crypto';
import { TriggerPlugin, TriggerEvent, Tool, FixStatus, WebhookRequest, WebhookConfig, SecretRequirement, PrefetchedData } from '../base';
import { findProjectsBySource } from '../../config/projects';
import { SentryWebhookPayload, SentryTag, isIssueCreatedEvent } from '../../types/webhooks/sentry';
import { getErrorMessage } from '../../types/errors';
import { getSecret } from '../../secrets';

/**
 * Sentry event data types for prefetch
 */
interface SentryStackFrame {
  filename?: string;
  absPath?: string;
  function?: string;
  lineNo?: number;
  colNo?: number;
  context?: Array<[number, string]>;
}

interface SentryException {
  type: string;
  value: string;
  stacktrace?: {
    frames: SentryStackFrame[];
  };
}

interface SentryBreadcrumb {
  timestamp?: number;
  category?: string;
  message?: string;
  data?: {
    url?: string;
    to?: string;
    [key: string]: unknown;
  };
}

interface SentryExceptionEntry {
  type: 'exception';
  data?: {
    values?: SentryException[];
  };
}

interface SentryBreadcrumbEntry {
  type: 'breadcrumbs';
  data?: {
    values?: SentryBreadcrumb[];
  };
}

interface SentryRequestEntry {
  type: 'request';
  data?: {
    method?: string;
    url?: string;
    headers?: Record<string, string>;
    [key: string]: unknown;
  };
}

type SentryEntry = SentryExceptionEntry | SentryBreadcrumbEntry | SentryRequestEntry | {
  type: string;
  data?: unknown;
};

interface SentryEventData {
  eventID: string;
  dateCreated?: string;
  entries?: SentryEntry[];
  tags?: Array<{ key: string; value: string }>;
  contexts?: Record<string, unknown>;
}

/**
 * Sentry trigger plugin
 * Handles Sentry issue webhooks and generates investigation tools
 *
 * Webhook setup:
 * 1. In Sentry project settings, go to "Webhooks"
 * 2. Set webhook URL to: https://your-domain/webhooks/sentry
 * 3. Enable "issue" events
 * 4. Set secret (optional but recommended)
 */
export class SentryTrigger implements TriggerPlugin {
  id = 'sentry';
  type = 'sentry';

  webhookConfig: WebhookConfig = {
    events: ['issue'],
    docsUrl: 'https://docs.sentry.io/product/integrations/integration-platform/webhooks/',
  };

  /**
   * Get header value from WebhookRequest
   */
  private getHeader(req: WebhookRequest, name: string): string | null {
    return req.headers.get(name);
  }

  /**
   * Validate Sentry webhook signature
   * https://docs.sentry.io/product/integrations/integration-platform/webhooks/#sentry-hook-signature
   */
  async validateWebhook(req: WebhookRequest): Promise<boolean> {
    const signature = this.getHeader(req, 'sentry-hook-signature');

    // If no signature provided and no secret configured, accept it
    if (!signature) {
      // In production, you should require signatures
      console.warn('[SentryTrigger] No signature provided - accepting webhook (not recommended for production)');
      return true;
    }

    // Verify signature if provided
    const secret = await getSecret('sentry', 'webhook_secret');
    if (!secret) {
      console.warn('[SentryTrigger] Signature provided but webhook secret not configured - rejecting webhook');
      return false;
    }

    // Use raw body for signature verification (JSON.stringify may produce different output)
    const body = req.rawBody ?? JSON.stringify(req.body);
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(body)
      .digest('hex');

    return signature === expectedSignature;
  }

  /**
   * Parse Sentry webhook payload into normalized TriggerEvent
   */
  async parseWebhook(payload: unknown): Promise<TriggerEvent | null> {
    const typedPayload = payload as SentryWebhookPayload;

    // Sentry sends different actions: created, resolved, assigned, etc.
    // We only care about new issues
    if (!isIssueCreatedEvent(typedPayload)) {
      console.log(`[SentryTrigger] Ignoring action: ${typedPayload.action}`);
      return null;
    }

    const issue = typedPayload.data?.issue;
    if (!issue) {
      console.error('[SentryTrigger] No issue data in payload');
      return null;
    }

    // Find project by Sentry project slug
    const sentryProject = typedPayload.data?.project;
    if (!sentryProject?.slug) {
      console.error('[SentryTrigger] No project slug in payload');
      return null;
    }

    const projects = await findProjectsBySource('sentry', (config) => {
      return !!config.enabled && config.projectSlug === sentryProject.slug;
    });

    if (projects.length === 0) {
      console.error(`[SentryTrigger] No project configured for Sentry slug: ${sentryProject.slug}`);
      return null;
    }

    if (projects.length > 1) {
      console.warn(`[SentryTrigger] Multiple projects found for Sentry slug ${sentryProject.slug}, using first one`);
    }

    const project = projects[0];

    // Extract error information
    const title = issue.title || issue.culprit || 'Unknown Error';
    const metadata = issue.metadata || {};
    const exceptionValues = metadata.value || '';
    const exceptionType = metadata.type || '';

    // Build description from exception details
    let description = '';
    if (exceptionType && exceptionValues) {
      description = `${exceptionType}: ${exceptionValues}`;
    } else if (exceptionValues) {
      description = exceptionValues;
    } else {
      description = title;
    }

    // Map Sentry level to our severity
    const level = issue.level as string;
    const severity = this.mapSentryLevelToSeverity(level);

    // Extract tags
    const tags = (issue.tags || []).map((tag: SentryTag) => `${tag.key}:${tag.value}`);

    // Get environment
    const environment = (issue.tags || []).find((tag: SentryTag) => tag.key === 'environment')?.value;

    // Get Sentry config from project (may have instanceUrl from .ai-bugs.json sync)
    const sentryConfig = project.triggers.sentry;
    const sentryBaseUrl = sentryConfig?.instanceUrl || 'https://sentry.io';

    return {
      triggerType: 'sentry',
      triggerId: issue.id,
      projectId: project.id,
      title,
      description,
      metadata: {
        severity,
        tags,
        environment,
        level,
        culprit: issue.culprit,
        platform: issue.platform,
        firstSeen: issue.firstSeen,
        lastSeen: issue.lastSeen,
        count: issue.count,
        userCount: issue.userCount,
        sentryProjectSlug: sentryProject.slug,
        // Store Sentry config for use in other methods
        sentryOrganization: sentryConfig?.organization,
        sentryInstanceUrl: sentryBaseUrl,
      },
      links: {
        web: issue.permalink,
        api: `${sentryBaseUrl}/api/0/issues/${issue.id}/`,
      },
      raw: typedPayload,
    };
  }

  /**
   * Map Sentry log level to our severity scale
   */
  private mapSentryLevelToSeverity(level: string): 'low' | 'medium' | 'high' | 'critical' {
    switch (level?.toLowerCase()) {
      case 'fatal':
      case 'error':
        return 'critical';
      case 'warning':
        return 'high';
      case 'info':
        return 'medium';
      case 'debug':
      default:
        return 'low';
    }
  }

  /**
   * Generate investigation tools for Claude
   * These are bash scripts that Claude can run to gather more information
   */
  async getTools(event: TriggerEvent): Promise<Tool[]> {
    const { triggerId, metadata } = event;
    const sentryToken = await getSecret('sentry', 'auth_token');
    const sentryBaseUrl = (metadata.sentryInstanceUrl as string) || 'https://sentry.io';

    if (!sentryToken) {
      console.warn('[SentryTrigger] Sentry auth token not configured - tools will be limited');
    }

    const tools: Tool[] = [];

    // Tool 1: Get full issue details
    if (sentryToken) {
      tools.push({
        name: 'get-sentry-issue',
        description: 'Get full Sentry issue details including metadata, tags, and context',
        script: `#!/bin/bash
# Fetch Sentry issue details
curl -s -H "Authorization: Bearer ${sentryToken}" \\
  "${sentryBaseUrl}/api/0/issues/${triggerId}/" | jq .
`,
        env: {
          SENTRY_AUTH_TOKEN: sentryToken,
        },
      });

      // Tool 2: Get latest events for this issue
      tools.push({
        name: 'get-sentry-events',
        description: 'Get the latest events (occurrences) for this issue with stack traces',
        script: `#!/bin/bash
# Fetch latest events for this issue
curl -s -H "Authorization: Bearer ${sentryToken}" \\
  "${sentryBaseUrl}/api/0/issues/${triggerId}/events/" | jq '.[] | {
    eventID: .eventID,
    dateCreated: .dateCreated,
    message: .message,
    platform: .platform,
    entries: .entries
  }'
`,
        env: {
          SENTRY_AUTH_TOKEN: sentryToken,
        },
      });

      // Tool 3: Get the most recent event with full details
      tools.push({
        name: 'get-latest-event',
        description: 'Get the most recent event with full stack trace and breadcrumbs',
        script: `#!/bin/bash
# Get latest event ID
EVENT_ID=$(curl -s -H "Authorization: Bearer ${sentryToken}" \\
  "${sentryBaseUrl}/api/0/issues/${triggerId}/events/" | jq -r '.[0].eventID')

if [ -z "$EVENT_ID" ] || [ "$EVENT_ID" = "null" ]; then
  echo "No events found for this issue"
  exit 1
fi

# Get full event details
curl -s -H "Authorization: Bearer ${sentryToken}" \\
  "${sentryBaseUrl}/api/0/issues/${triggerId}/events/$EVENT_ID/" | jq .
`,
        env: {
          SENTRY_AUTH_TOKEN: sentryToken,
        },
      });
    }

    // Tool 4: Extract issue summary from raw payload (always available)
    tools.push({
      name: 'show-issue-summary',
      description: 'Show a formatted summary of the Sentry issue',
      script: `#!/bin/bash
cat <<'EOF'
Sentry Issue: ${event.title}

Platform: ${metadata.platform || 'unknown'}
Level: ${metadata.level || 'unknown'}
Culprit: ${metadata.culprit || 'unknown'}
Environment: ${metadata.environment || 'unknown'}

First Seen: ${metadata.firstSeen || 'unknown'}
Last Seen: ${metadata.lastSeen || 'unknown'}
Count: ${metadata.count || 0}
User Count: ${metadata.userCount || 0}

Tags:
${(metadata.tags || []).join('\n') || 'none'}

Description:
${event.description}

Web Link: ${event.links?.web || 'N/A'}
EOF
`,
    });

    return tools;
  }

  /**
   * Generate context for Claude's investigation prompt
   */
  getPromptContext(event: TriggerEvent): string {
    const { title, description, metadata, links } = event;

    let context = `## Sentry Issue\n\n`;
    context += `**Title:** ${title}\n`;
    context += `**Description:** ${description}\n`;
    context += `**Severity:** ${metadata.severity || 'unknown'}\n`;
    context += `**Level:** ${metadata.level || 'unknown'}\n`;

    if (metadata.culprit) {
      context += `**Culprit:** ${metadata.culprit}\n`;
    }

    if (metadata.platform) {
      context += `**Platform:** ${metadata.platform}\n`;
    }

    if (metadata.environment) {
      context += `**Environment:** ${metadata.environment}\n`;
    }

    if (metadata.count) {
      context += `**Occurrences:** ${metadata.count} (${metadata.userCount || 0} users affected)\n`;
    }

    if (metadata.tags && metadata.tags.length > 0) {
      context += `**Tags:** ${metadata.tags.join(', ')}\n`;
    }

    if (links?.web) {
      context += `\n[View in Sentry](${links.web})\n`;
    }

    return context;
  }

  /**
   * Update issue status in Sentry
   */
  async updateStatus(event: TriggerEvent, status: FixStatus): Promise<void> {
    const sentryToken = await getSecret('sentry', 'auth_token');
    if (!sentryToken) {
      console.warn('[SentryTrigger] Cannot update status - Sentry auth token not configured');
      return;
    }

    const { triggerId, metadata } = event;
    const sentryBaseUrl = (metadata.sentryInstanceUrl as string) || 'https://sentry.io';

    // If fixed successfully, mark issue as resolved
    if (status.fixed) {
      try {
        const response = await fetch(`${sentryBaseUrl}/api/0/issues/${triggerId}/`, {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${sentryToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            status: 'resolved',
            statusDetails: {
              inRelease: 'latest',
            },
          }),
        });

        if (!response.ok) {
          console.error(`[SentryTrigger] Failed to update issue status: ${response.statusText}`);
        } else {
          console.log(`[SentryTrigger] Marked issue ${triggerId} as resolved`);
        }
      } catch (error) {
        console.error('[SentryTrigger] Error updating issue status:', getErrorMessage(error));
      }
    }
  }

  /**
   * Add a comment to the Sentry issue
   */
  async addComment(event: TriggerEvent, comment: string): Promise<void> {
    const sentryToken = await getSecret('sentry', 'auth_token');
    if (!sentryToken) {
      console.warn('[SentryTrigger] Cannot add comment - Sentry auth token not configured');
      return;
    }

    const { triggerId, metadata } = event;
    const sentryBaseUrl = (metadata.sentryInstanceUrl as string) || 'https://sentry.io';

    try {
      const response = await fetch(`${sentryBaseUrl}/api/0/issues/${triggerId}/notes/`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${sentryToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: comment,
        }),
      });

      if (!response.ok) {
        console.error(`[SentryTrigger] Failed to add comment: ${response.statusText}`);
      } else {
        console.log(`[SentryTrigger] Added comment to issue ${triggerId}`);
      }
    } catch (error) {
      console.error('[SentryTrigger] Error adding comment:', getErrorMessage(error));
    }
  }

  /**
   * Generate markdown link to the issue
   */
  getLink(event: TriggerEvent): string {
    const { title, links } = event;
    return `[${title}](${links?.web || '#'})`;
  }

  /**
   * Optional: Decide if we should process this issue
   * You can add custom logic here to filter issues
   */
  async shouldProcess(event: TriggerEvent): Promise<boolean> {
    // Skip debug-level issues
    if (event.metadata.level === 'debug') {
      console.log('[SentryTrigger] Skipping debug-level issue');
      return false;
    }

    // Only process errors and fatals by default
    const level = event.metadata.level as string;
    if (level && !['error', 'fatal', 'warning'].includes(level.toLowerCase())) {
      console.log(`[SentryTrigger] Skipping non-error issue (level: ${level})`);
      return false;
    }

    return true;
  }

  /**
   * Pre-fetch Sentry data for inclusion in prompts
   * Fetches the latest event with full stack trace and breadcrumbs
   */
  async prefetchData(event: TriggerEvent): Promise<PrefetchedData | undefined> {
    const sentryToken = await getSecret('sentry', 'auth_token');
    if (!sentryToken) {
      console.warn('[SentryTrigger] Cannot prefetch data - Sentry auth token not configured');
      return undefined;
    }

    const { triggerId, metadata } = event;
    const sentryBaseUrl = (metadata.sentryInstanceUrl as string) || 'https://sentry.io';

    try {
      // Fetch the latest event for this issue
      const eventsResponse = await fetch(
        `${sentryBaseUrl}/api/0/issues/${triggerId}/events/`,
        {
          headers: {
            'Authorization': `Bearer ${sentryToken}`,
          },
        }
      );

      if (!eventsResponse.ok) {
        console.warn(`[SentryTrigger] Failed to fetch events: ${eventsResponse.statusText}`);
        return undefined;
      }

      const events = await eventsResponse.json() as Array<{ eventID: string }>;
      if (!events || events.length === 0) {
        console.log('[SentryTrigger] No events found for issue');
        return undefined;
      }

      // Get the latest event with full details
      const latestEventId = events[0].eventID;
      const eventResponse = await fetch(
        `${sentryBaseUrl}/api/0/issues/${triggerId}/events/${latestEventId}/`,
        {
          headers: {
            'Authorization': `Bearer ${sentryToken}`,
          },
        }
      );

      if (!eventResponse.ok) {
        console.warn(`[SentryTrigger] Failed to fetch event details: ${eventResponse.statusText}`);
        return undefined;
      }

      const eventData = await eventResponse.json() as SentryEventData;

      // Build prefetched data
      return this.formatPrefetchedData(event, eventData);
    } catch (error) {
      console.error('[SentryTrigger] Error prefetching data:', getErrorMessage(error));
      return undefined;
    }
  }

  /**
   * Format Sentry event data into PrefetchedData structure
   */
  private formatPrefetchedData(event: TriggerEvent, eventData: SentryEventData): PrefetchedData {
    const parts: string[] = [];

    // Build summary
    parts.push(`**Error:** ${event.title}`);
    parts.push(`**Event ID:** ${eventData.eventID}`);
    if (eventData.dateCreated) {
      parts.push(`**Occurred:** ${eventData.dateCreated}`);
    }
    if (event.metadata.environment) {
      parts.push(`**Environment:** ${event.metadata.environment}`);
    }

    // Extract stack trace
    let stackTrace: string | undefined;
    const exceptionEntry = eventData.entries?.find((e): e is SentryExceptionEntry => e.type === 'exception');
    if (exceptionEntry?.data?.values) {
      const stackTraceLines: string[] = [];
      for (const exc of exceptionEntry.data.values) {
        stackTraceLines.push(`${exc.type}: ${exc.value}`);
        if (exc.stacktrace?.frames) {
          // Frames are in reverse order (most recent last)
          const frames = [...exc.stacktrace.frames].reverse();
          for (const frame of frames) {
            const filename = frame.filename || frame.absPath || '?';
            const func = frame.function || '?';
            const line = frame.lineNo || '?';
            const col = frame.colNo ? `:${frame.colNo}` : '';
            stackTraceLines.push(`  at ${func} (${filename}:${line}${col})`);
            if (frame.context) {
              // Include context lines if available
              for (const [lineNum, code] of frame.context) {
                const prefix = lineNum === frame.lineNo ? '>' : ' ';
                stackTraceLines.push(`    ${prefix} ${lineNum}: ${code}`);
              }
            }
          }
        }
        stackTraceLines.push('');
      }
      stackTrace = stackTraceLines.join('\n');
    }

    // Extract breadcrumbs
    let breadcrumbs: string | undefined;
    const breadcrumbEntry = eventData.entries?.find((e): e is SentryBreadcrumbEntry => e.type === 'breadcrumbs');
    if (breadcrumbEntry?.data?.values) {
      const breadcrumbLines: string[] = [];
      // Show last 20 breadcrumbs
      const recentBreadcrumbs = breadcrumbEntry.data.values.slice(-20);
      for (const crumb of recentBreadcrumbs) {
        const timestamp = crumb.timestamp ? new Date(crumb.timestamp * 1000).toISOString() : '?';
        const category = crumb.category || 'unknown';
        const message = crumb.message || crumb.data?.url || crumb.data?.to || '';
        breadcrumbLines.push(`[${timestamp}] ${category}: ${message}`);
      }
      breadcrumbs = breadcrumbLines.join('\n');
    }

    // Extract additional context (request, user, tags)
    const additionalParts: string[] = [];

    // Request context
    const requestEntry = eventData.entries?.find((e): e is SentryRequestEntry => e.type === 'request');
    if (requestEntry?.data) {
      additionalParts.push('**Request:**');
      if (requestEntry.data.method && requestEntry.data.url) {
        additionalParts.push(`- ${requestEntry.data.method} ${requestEntry.data.url}`);
      }
      if (requestEntry.data.headers) {
        const userAgent = requestEntry.data.headers['User-Agent'] || requestEntry.data.headers['user-agent'];
        if (userAgent) {
          additionalParts.push(`- User-Agent: ${userAgent}`);
        }
      }
      additionalParts.push('');
    }

    // Tags
    if (eventData.tags && eventData.tags.length > 0) {
      additionalParts.push('**Tags:**');
      for (const tag of eventData.tags.slice(0, 10)) {
        additionalParts.push(`- ${tag.key}: ${tag.value}`);
      }
      additionalParts.push('');
    }

    // Context (custom context)
    if (eventData.contexts) {
      const contextKeys = Object.keys(eventData.contexts).filter(
        (k) => !['browser', 'os', 'device'].includes(k)
      );
      if (contextKeys.length > 0) {
        additionalParts.push('**Context:**');
        for (const key of contextKeys.slice(0, 5)) {
          additionalParts.push(`- ${key}: ${JSON.stringify(eventData.contexts[key])}`);
        }
      }
    }

    return {
      summary: parts.join('\n'),
      stackTrace,
      breadcrumbs,
      additionalContext: additionalParts.length > 0 ? additionalParts.join('\n') : undefined,
    };
  }

  /**
   * Get the secrets required by this trigger
   */
  getRequiredSecrets(): SecretRequirement[] {
    return [
      {
        id: 'sentry_token',
        label: 'Sentry Auth Token',
        description: 'Authentication token for Sentry API (used to fetch issue details and post comments)',
        required: true,
        plugin: 'sentry',
        key: 'auth_token',
      },
      {
        id: 'sentry_webhook_secret',
        label: 'Sentry Client Secret',
        description: 'Client Secret from Internal Integration (required for webhook signature verification)',
        required: true,
        plugin: 'sentry',
        key: 'webhook_secret',
      },
    ];
  }
}
