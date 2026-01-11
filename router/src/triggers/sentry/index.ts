import { Request } from 'express';
import crypto from 'crypto';
import { TriggerPlugin, TriggerEvent, Tool, FixStatus } from '../base';
import { findProjectsBySource } from '../../config/projects';
import { SentryWebhookPayload, SentryTag, isIssueCreatedEvent } from '../../types/webhooks/sentry';
import { getErrorMessage } from '../../types/errors';

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

  /**
   * Validate Sentry webhook signature
   * https://docs.sentry.io/product/integrations/integration-platform/webhooks/#sentry-hook-signature
   */
  async validateWebhook(req: Request): Promise<boolean> {
    const signature = req.headers['sentry-hook-signature'] as string;

    // If no signature provided and no secret configured, accept it
    if (!signature) {
      // In production, you should require signatures
      console.warn('[SentryTrigger] No signature provided - accepting webhook (not recommended for production)');
      return true;
    }

    // Verify signature if provided
    const secret = process.env.SENTRY_WEBHOOK_SECRET;
    if (!secret) {
      console.warn('[SentryTrigger] Signature provided but SENTRY_WEBHOOK_SECRET not set - rejecting webhook');
      return false;
    }

    const body = JSON.stringify(req.body);
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

    const projects = findProjectsBySource('sentry', (config) => {
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
      },
      links: {
        web: issue.permalink,
        api: `https://sentry.io/api/0/issues/${issue.id}/`,
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
  getTools(event: TriggerEvent): Tool[] {
    const { triggerId, metadata } = event;
    const sentryToken = process.env.SENTRY_AUTH_TOKEN;

    if (!sentryToken) {
      console.warn('[SentryTrigger] SENTRY_AUTH_TOKEN not set - tools will be limited');
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
  "https://sentry.io/api/0/issues/${triggerId}/" | jq .
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
  "https://sentry.io/api/0/issues/${triggerId}/events/" | jq '.[] | {
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
  "https://sentry.io/api/0/issues/${triggerId}/events/" | jq -r '.[0].eventID')

if [ -z "$EVENT_ID" ] || [ "$EVENT_ID" = "null" ]; then
  echo "No events found for this issue"
  exit 1
fi

# Get full event details
curl -s -H "Authorization: Bearer ${sentryToken}" \\
  "https://sentry.io/api/0/issues/${triggerId}/events/$EVENT_ID/" | jq .
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
    const sentryToken = process.env.SENTRY_AUTH_TOKEN;
    if (!sentryToken) {
      console.warn('[SentryTrigger] Cannot update status - SENTRY_AUTH_TOKEN not set');
      return;
    }

    const { triggerId } = event;

    // If fixed successfully, mark issue as resolved
    if (status.fixed) {
      try {
        const response = await fetch(`https://sentry.io/api/0/issues/${triggerId}/`, {
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
    const sentryToken = process.env.SENTRY_AUTH_TOKEN;
    if (!sentryToken) {
      console.warn('[SentryTrigger] Cannot add comment - SENTRY_AUTH_TOKEN not set');
      return;
    }

    const { triggerId } = event;

    try {
      const response = await fetch(`https://sentry.io/api/0/issues/${triggerId}/notes/`, {
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
}
