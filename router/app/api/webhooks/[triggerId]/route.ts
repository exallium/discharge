import { NextRequest, NextResponse } from 'next/server';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

import { getTriggerById, listTriggerIds } from '@/src/triggers';
import { queueFixJob } from '@/src/queue';
import { getEventRouter } from '@/src/conversation/router';
import { withLogging, extractWebhookContext, setLoggingContext, getRequestId } from '@/lib/api-logger';
import type { WebhookRequest } from '@/src/triggers/base';
import { findProjectByRepo } from '@/src/config/projects';

interface RouteParams {
  params: Promise<{ triggerId: string }>;
}

/**
 * Adapter to convert Next.js request to WebhookRequest
 */
function createWebhookRequest(req: NextRequest, body: unknown, rawBody: string): WebhookRequest {
  return {
    headers: req.headers,
    body,
    rawBody,
  };
}

/**
 * Parse webhook body - handles both JSON and form-encoded payloads
 * GitHub can send webhooks as either application/json or application/x-www-form-urlencoded
 * Returns both parsed body and raw string for signature verification
 */
/**
 * Diagnose why a webhook event was filtered
 * Provides more specific reasons for logging/debugging
 */
interface FilterDiagnosis {
  summary: string;
  detail: string;
  eventInfo?: Record<string, unknown>;
}

async function diagnoseFilterReason(triggerId: string, body: unknown): Promise<FilterDiagnosis> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payload = body as any;

  // Extract common fields for logging
  const eventInfo: Record<string, unknown> = {};

  if (triggerId === 'github-issues') {
    const action = payload?.action;
    const repoFullName = payload?.repository?.full_name;
    const issueNumber = payload?.issue?.number;
    const issueLabels = payload?.issue?.labels?.map((l: { name: string }) => l.name) || [];
    const commentBody = payload?.comment?.body;
    const eventType = payload?.issue ? (payload?.comment ? 'issue_comment' : 'issues') : 'unknown';

    eventInfo.action = action;
    eventInfo.repoFullName = repoFullName;
    eventInfo.issueNumber = issueNumber;
    eventInfo.labels = issueLabels;
    eventInfo.eventType = eventType;

    // Check for unsupported action
    if (eventType === 'issues' && !['opened', 'labeled', 'reopened'].includes(action)) {
      return {
        summary: `Unsupported issue action: ${action}`,
        detail: `GitHub issues trigger only processes 'opened', 'labeled', 'reopened' actions. Received: ${action}`,
        eventInfo,
      };
    }

    if (eventType === 'issue_comment' && action !== 'created') {
      return {
        summary: `Unsupported comment action: ${action}`,
        detail: `GitHub issues trigger only processes 'created' comment actions. Received: ${action}`,
        eventInfo,
      };
    }

    // Check if project exists
    if (repoFullName) {
      const project = await findProjectByRepo(repoFullName);

      if (!project) {
        return {
          summary: `No project configured for repository: ${repoFullName}`,
          detail: `Repository ${repoFullName} is not registered as a project. Add it via the admin UI.`,
          eventInfo,
        };
      }

      eventInfo.projectId = project.id;

      // Check if GitHub issues trigger is enabled
      const githubConfig = project.triggers.github;
      if (!githubConfig?.issues) {
        return {
          summary: `GitHub issues trigger not enabled for ${repoFullName}`,
          detail: `Project exists but triggers.github.issues is not enabled. Enable it in project settings.`,
          eventInfo,
        };
      }

      // Check label requirements
      if (githubConfig.requireLabel && githubConfig.labels && githubConfig.labels.length > 0) {
        const hasRequiredLabel = githubConfig.labels.some((label: string) => issueLabels.includes(label));
        if (!hasRequiredLabel) {
          return {
            summary: `Issue missing required label`,
            detail: `Issue #${issueNumber} requires one of labels: [${githubConfig.labels.join(', ')}]. Has: [${issueLabels.join(', ')}]`,
            eventInfo,
          };
        }
      } else if (githubConfig.labels && githubConfig.labels.length > 0 && action === 'opened') {
        const hasMatchingLabel = githubConfig.labels.some((label: string) => issueLabels.includes(label));
        if (!hasMatchingLabel) {
          return {
            summary: `Issue opened without trigger label`,
            detail: `Issue #${issueNumber} doesn't have a configured trigger label. Will process if label is added later. Configured labels: [${githubConfig.labels.join(', ')}]`,
            eventInfo,
          };
        }
      }

      // Check comment trigger requirements
      if (eventType === 'issue_comment') {
        if (!githubConfig.commentTrigger) {
          return {
            summary: `Comment trigger not configured`,
            detail: `Project ${repoFullName} doesn't have a commentTrigger configured (e.g., "/claude fix")`,
            eventInfo,
          };
        }

        if (commentBody && !commentBody.includes(githubConfig.commentTrigger)) {
          return {
            summary: `Comment missing trigger phrase`,
            detail: `Comment doesn't contain trigger phrase "${githubConfig.commentTrigger}"`,
            eventInfo,
          };
        }

        const commenter = payload?.comment?.user?.login;
        if (githubConfig.allowedUsers && githubConfig.allowedUsers.length > 0) {
          if (!commenter || !githubConfig.allowedUsers.includes(commenter)) {
            return {
              summary: `User not authorized to trigger`,
              detail: `User "${commenter}" not in allowedUsers list: [${githubConfig.allowedUsers.join(', ')}]`,
              eventInfo,
            };
          }
        }
      }
    }
  }

  // Generic fallback for other triggers or unknown reasons
  return {
    summary: 'Event not applicable for this trigger',
    detail: 'Trigger parseWebhook returned null - event does not match processing criteria',
    eventInfo: Object.keys(eventInfo).length > 0 ? eventInfo : undefined,
  };
}

async function parseWebhookBody(request: NextRequest): Promise<{ body: unknown; rawBody: string }> {
  const contentType = request.headers.get('content-type') || '';

  // Always get raw text first for signature verification
  const rawBody = await request.text();

  if (contentType.includes('application/json')) {
    return { body: JSON.parse(rawBody), rawBody };
  }

  if (contentType.includes('application/x-www-form-urlencoded')) {
    const params = new URLSearchParams(rawBody);
    const payload = params.get('payload');
    if (payload) {
      return { body: JSON.parse(payload), rawBody };
    }
    throw new Error('No payload found in form data');
  }

  // Try JSON as fallback
  return { body: JSON.parse(rawBody), rawBody };
}

/**
 * POST /api/webhooks/[triggerId]
 * Generic webhook endpoint - each trigger plugin handles its own validation and parsing
 */
async function handlePost(request: NextRequest, { params }: RouteParams) {
  const { triggerId } = await params;
  const requestId = getRequestId(request);
  const trigger = getTriggerById(triggerId);

  // Check if trigger exists
  if (!trigger) {
    setLoggingContext(request, {
      outcome: 'not_found',
      outcomeReason: `Trigger "${triggerId}" not found`,
      details: { available: listTriggerIds() },
    });
    return NextResponse.json(
      {
        error: 'Unknown trigger',
        available: listTriggerIds(),
        requestId,
      },
      { status: 404 }
    );
  }

  try {
    // Parse request body (handles both JSON and form-encoded)
    const { body, rawBody } = await parseWebhookBody(request);

    // Create WebhookRequest adapter
    const webhookReq = createWebhookRequest(request, body, rawBody);

    // Validate webhook signature/authentication
    const isValid = await trigger.validateWebhook(webhookReq);
    if (!isValid) {
      setLoggingContext(request, {
        outcome: 'validation_failed',
        outcomeReason: 'Webhook signature validation failed',
        details: {
          validationResult: { valid: false, reason: 'Signature mismatch or secret not configured' },
        },
      });
      return NextResponse.json(
        { error: 'Invalid webhook signature', requestId },
        { status: 401 }
      );
    }

    // Log successful validation
    setLoggingContext(request, {
      details: { validationResult: { valid: true } },
    });

    // Parse webhook payload into normalized event
    const event = await trigger.parseWebhook(body);
    if (!event) {
      // Try to determine why it was filtered for better logging
      const filterReason = await diagnoseFilterReason(triggerId, body);
      setLoggingContext(request, {
        outcome: 'filtered',
        outcomeReason: filterReason.summary,
        details: {
          parseResult: { success: false, reason: filterReason.detail },
          eventInfo: filterReason.eventInfo,
        },
      });
      return NextResponse.json({
        ignored: true,
        reason: filterReason.summary,
        requestId,
      });
    }

    // Log parsed event info
    setLoggingContext(request, {
      projectId: event.projectId,
      details: {
        parseResult: { success: true },
        eventInfo: {
          triggerType: event.triggerType,
          triggerId: event.triggerId,
          title: event.title,
        },
      },
    });

    // Optional pre-processing filter
    if (trigger.shouldProcess) {
      const shouldProcess = await trigger.shouldProcess(event);
      if (!shouldProcess) {
        setLoggingContext(request, {
          outcome: 'filtered',
          outcomeReason: 'Event filtered by shouldProcess check',
          details: {
            filterResult: { processed: false, reason: 'shouldProcess returned false' },
          },
        });
        return NextResponse.json({
          ignored: true,
          reason: 'Event filtered by shouldProcess',
          requestId,
        });
      }
      setLoggingContext(request, {
        details: { filterResult: { processed: true } },
      });
    }

    // Route through conversation system for triggers that support it
    if (trigger.supportsConversation && trigger.parseConversationEvent) {
      const conversationEvent = await trigger.parseConversationEvent(body);

      if (conversationEvent) {
        // Route through EventRouter
        const eventRouter = getEventRouter();
        const routeResult = await eventRouter.routeEvent(
          trigger,
          conversationEvent,
          event
        );

        const isQueued = routeResult.action === 'started_job' || routeResult.action === 'queued_event';
        setLoggingContext(request, {
          outcome: isQueued ? 'queued' : 'filtered',
          outcomeReason: `Conversation router: ${routeResult.action}${routeResult.reason ? ` - ${routeResult.reason}` : ''}`,
          jobId: routeResult.jobId,
          details: {
            queueResult: {
              jobId: routeResult.jobId,
              conversationId: routeResult.conversationId,
              action: routeResult.action,
            },
            responseBody: {
              queued: isQueued,
              action: routeResult.action,
              conversationId: routeResult.conversationId,
              jobId: routeResult.jobId,
            },
          },
        });

        return NextResponse.json(
          {
            queued: isQueued,
            action: routeResult.action,
            conversationId: routeResult.conversationId,
            jobId: routeResult.jobId,
            reason: routeResult.reason,
            triggerType: event.triggerType,
            triggerId: event.triggerId,
            projectId: event.projectId,
            requestId,
          },
          { status: 202 }
        );
      }

      // Conversation-enabled trigger returned null - filter the event (don't fall through to legacy)
      setLoggingContext(request, {
        outcome: 'filtered',
        outcomeReason: 'Event not recognized by conversation trigger',
        details: {
          responseBody: {
            queued: false,
            reason: 'Event type not supported',
          },
        },
      });

      return NextResponse.json(
        {
          queued: false,
          reason: 'Event type not supported',
          triggerType: event.triggerType,
          triggerId: event.triggerId,
          projectId: event.projectId,
          requestId,
        },
        { status: 200 }
      );
    }

    // Legacy flow for triggers that don't support conversation mode
    const jobId = await queueFixJob({
      event,
      triggerType: trigger.type,
      queuedAt: new Date().toISOString(),
    });

    setLoggingContext(request, {
      outcome: 'queued',
      outcomeReason: 'Job queued for processing (legacy flow)',
      jobId,
      details: {
        queueResult: { jobId },
        responseBody: {
          queued: true,
          jobId,
          triggerType: event.triggerType,
          triggerId: event.triggerId,
          projectId: event.projectId,
        },
      },
    });

    return NextResponse.json(
      {
        queued: true,
        jobId,
        triggerType: event.triggerType,
        triggerId: event.triggerId,
        projectId: event.projectId,
        requestId,
      },
      { status: 202 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[${triggerId}] Webhook error:`, error);
    setLoggingContext(request, {
      outcome: 'error',
      outcomeReason: `Server error: ${message}`,
      details: {
        error: {
          message,
          stack: error instanceof Error ? error.stack : undefined,
        },
      },
    });
    return NextResponse.json({ error: message, requestId }, { status: 500 });
  }
}

// Export wrapped handler with logging
export const POST = withLogging(handlePost, extractWebhookContext);

/**
 * GET /api/webhooks/[triggerId]
 * Info about a specific webhook endpoint
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { triggerId } = await params;
  const trigger = getTriggerById(triggerId);

  if (!trigger) {
    return NextResponse.json(
      {
        error: 'Unknown trigger',
        available: listTriggerIds(),
      },
      { status: 404 }
    );
  }

  return NextResponse.json({
    id: trigger.id,
    type: trigger.type,
    supportsConversation: trigger.supportsConversation || false,
    method: 'POST',
  });
}
