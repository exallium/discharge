import { NextRequest, NextResponse } from 'next/server';
import { findProjectsBySource } from '@/src/config/projects';
import { getTriggerById } from '@/src/triggers';
import { getEventRouter } from '@/src/conversation/router';
import type { TriggerEvent } from '@/src/triggers/base';
import type { ConversationEvent } from '@/src/types/conversation';

export const dynamic = 'force-dynamic';

/**
 * Sentry UI Component webhook payload
 * https://docs.sentry.io/organization/integrations/integration-platform/ui-components/issue-link/
 */
interface SentryUIComponentPayload {
  fields: Record<string, string>;
  installationId: string;
  issueId: string;
  webUrl: string;
  project: {
    slug: string;
    id: string;
  };
  actor: {
    type: string;
    name: string;
    id: string;
  };
}

/**
 * POST /api/webhooks/sentry-ui
 * Handle Sentry UI Component (Issue Link) webhooks for manual triage/investigation triggers
 */
export async function POST(request: NextRequest) {
  try {
    const payload: SentryUIComponentPayload = await request.json();

    console.log('[SentryUI] Received UI component webhook:', {
      issueId: payload.issueId,
      projectSlug: payload.project?.slug,
      fields: payload.fields,
      actor: payload.actor?.name,
    });

    // Find project by Sentry project slug
    const sentryProjectSlug = payload.project?.slug;
    if (!sentryProjectSlug) {
      return NextResponse.json(
        { message: 'Missing project slug in payload' },
        { status: 400 }
      );
    }

    const projects = await findProjectsBySource('sentry', (config) => {
      return !!config.enabled && config.projectSlug === sentryProjectSlug;
    });

    if (projects.length === 0) {
      return NextResponse.json(
        { message: `No project configured for Sentry project: ${sentryProjectSlug}` },
        { status: 404 }
      );
    }

    const project = projects[0];
    const mode = payload.fields?.mode || 'triage';

    // Get the Sentry trigger plugin
    const trigger = getTriggerById('sentry');
    if (!trigger) {
      return NextResponse.json(
        { message: 'Sentry trigger not configured' },
        { status: 500 }
      );
    }

    // Create trigger event
    const triggerEvent: TriggerEvent = {
      triggerType: 'sentry',
      triggerId: payload.issueId,
      projectId: project.id,
      title: `Sentry Issue ${payload.issueId}`,
      description: `Manually triggered ${mode} from Sentry UI by ${payload.actor?.name || 'unknown'}`,
      metadata: {
        severity: 'medium',
        tags: ['manual-trigger', `mode:${mode}`],
        mode,
        sentryIssueId: payload.issueId,
        sentryProjectSlug,
        sentryWebUrl: payload.webUrl,
        triggeredBy: payload.actor?.name,
        sentryInstanceUrl: project.triggers?.sentry?.instanceUrl,
      },
      links: {
        web: payload.webUrl,
      },
      raw: payload,
    };

    // Create conversation event for the router
    const conversationEvent: ConversationEvent = {
      type: 'issue_opened',
      source: {
        platform: 'sentry',
        externalId: payload.issueId,
        url: payload.webUrl,
      },
      target: {
        type: 'issue',
        number: payload.issueId,
        title: `Sentry Issue ${payload.issueId}`,
        body: `Manually triggered ${mode} by ${payload.actor?.name || 'unknown'}`,
        labels: ['manual-trigger', `mode:${mode}`],
        url: payload.webUrl,
      },
      payload: {
        action: 'opened',
      },
      timestamp: new Date().toISOString(),
    };

    // Route through conversation system
    const eventRouter = getEventRouter();
    const routeResult = await eventRouter.routeEvent(trigger, conversationEvent, triggerEvent);

    console.log('[SentryUI] Event routed:', {
      action: routeResult.action,
      conversationId: routeResult.conversationId,
      jobId: routeResult.jobId,
      issueId: payload.issueId,
    });

    // Derive base URL from request headers
    const host = request.headers.get('host') || 'localhost:3000';
    const protocol = request.headers.get('x-forwarded-proto') || 'http';
    const baseUrl = `${protocol}://${host}`;

    // Return response in Sentry's expected format
    // Link to conversation detail page if we have a conversation ID
    const webUrl = routeResult.conversationId
      ? `${baseUrl}/jobs/${routeResult.conversationId}`
      : `${baseUrl}/jobs?tab=jobs`;

    return NextResponse.json({
      webUrl,
      project: 'Discharge',
      identifier: routeResult.conversationId || `Job #${routeResult.jobId}`,
    });
  } catch (error) {
    console.error('[SentryUI] Failed to process webhook:', error);
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to process request' },
      { status: 500 }
    );
  }
}
