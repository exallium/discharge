/**
 * API request logging utilities
 *
 * Provides a wrapper for Next.js route handlers that logs requests to the database
 * with webhook-specific context extraction.
 */

import { NextRequest, NextResponse } from 'next/server';
import { apiLogsRepo } from '@/src/db/repositories';
import { logger, generateRequestId } from '@/src/logger';

/**
 * Context extracted from webhook requests
 */
export interface LoggingContext {
  triggerId?: string;
  eventType?: string;
  payloadSummary?: Record<string, unknown>;
}

/**
 * Route handler type for Next.js App Router
 * Using 'any' for context to allow flexibility with different param types
 */
type RouteHandler = (
  request: NextRequest,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  context?: any
) => Promise<NextResponse>;

/**
 * Context extractor function type
 */
type ContextExtractor = (
  request: NextRequest,
  body?: unknown
) => LoggingContext;

/**
 * Extract IP address from request headers
 */
function getClientIp(request: NextRequest): string | null {
  // Check common headers for proxied requests
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    return forwardedFor.split(',')[0]?.trim() || null;
  }

  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    return realIp;
  }

  return null;
}

/**
 * Wrap a route handler with logging
 *
 * @param handler - The route handler function to wrap
 * @param extractContext - Optional function to extract webhook-specific context
 * @returns Wrapped handler that logs requests to the database
 */
export function withLogging(
  handler: RouteHandler,
  extractContext?: ContextExtractor
): RouteHandler {
  return async (request, routeContext) => {
    const requestId = generateRequestId();
    const startTime = Date.now();
    const path = request.nextUrl.pathname;
    const method = request.method;

    let responseStatus = 500;
    let error: string | null = null;
    let loggingContext: LoggingContext = {};

    try {
      // Try to extract context from request body for POST/PUT/PATCH
      if (extractContext && ['POST', 'PUT', 'PATCH'].includes(method)) {
        try {
          const clonedRequest = request.clone();
          const body = await clonedRequest.json();
          loggingContext = extractContext(request, body);
        } catch {
          // Body might not be JSON, continue without context
        }
      }

      // Execute the actual handler
      const response = await handler(request, routeContext);
      responseStatus = response.status;

      return response;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      responseStatus = 500;
      throw err;
    } finally {
      const responseTimeMs = Date.now() - startTime;

      // Log to database (async, don't block response)
      apiLogsRepo
        .create({
          method,
          path,
          statusCode: responseStatus,
          responseTimeMs,
          ipAddress: getClientIp(request),
          userAgent: request.headers.get('user-agent'),
          triggerId: loggingContext.triggerId || null,
          eventType: loggingContext.eventType || null,
          payloadSummary: loggingContext.payloadSummary || null,
          error,
        })
        .catch((logError) => {
          // Don't fail the request if logging fails
          logger.error('Failed to write API log', {
            requestId,
            error: logError instanceof Error ? logError.message : String(logError),
          });
        });

      // Also log to Winston for real-time monitoring
      logger.info('API request', {
        requestId,
        method,
        path,
        statusCode: responseStatus,
        responseTimeMs,
        triggerId: loggingContext.triggerId,
        eventType: loggingContext.eventType,
      });
    }
  };
}

/**
 * Extract webhook-specific context from a request
 *
 * @param request - The incoming request
 * @param body - The parsed request body
 * @returns Logging context with webhook details
 */
export function extractWebhookContext(
  request: NextRequest,
  body?: unknown
): LoggingContext {
  // Extract triggerId from URL path (last segment of /api/webhooks/[triggerId])
  const pathParts = request.nextUrl.pathname.split('/');
  const triggerId = pathParts[pathParts.length - 1];

  if (!body || typeof body !== 'object') {
    return { triggerId };
  }

  const payload = body as Record<string, unknown>;
  const payloadSummary: Record<string, unknown> = {};

  // GitHub-style events
  if (payload.action) {
    payloadSummary.action = payload.action;
  }
  if (payload.repository && typeof payload.repository === 'object') {
    const repo = payload.repository as Record<string, unknown>;
    payloadSummary.repository = repo.full_name;
  }
  if (payload.issue && typeof payload.issue === 'object') {
    const issue = payload.issue as Record<string, unknown>;
    payloadSummary.issueNumber = issue.number;
    payloadSummary.issueTitle = truncate(issue.title as string, 100);
  }
  if (payload.pull_request && typeof payload.pull_request === 'object') {
    const pr = payload.pull_request as Record<string, unknown>;
    payloadSummary.prNumber = pr.number;
    payloadSummary.prTitle = truncate(pr.title as string, 100);
  }
  if (payload.sender && typeof payload.sender === 'object') {
    const sender = payload.sender as Record<string, unknown>;
    payloadSummary.sender = sender.login;
  }

  // Sentry-style events
  if (payload.event_id) {
    payloadSummary.eventId = payload.event_id;
  }
  if (payload.event && typeof payload.event === 'object') {
    const event = payload.event as Record<string, unknown>;
    if (event.type) payloadSummary.errorType = event.type;
    if (event.title) payloadSummary.errorTitle = truncate(event.title as string, 100);
  }

  // Determine event type from headers or payload
  let eventType = request.headers.get('x-github-event');

  if (!eventType && payload.action && typeof payload.action === 'string') {
    // Construct event type from action and resource
    if (payload.issue) {
      eventType = `issues.${payload.action}`;
    } else if (payload.pull_request) {
      eventType = `pull_request.${payload.action}`;
    } else if (payload.comment) {
      eventType = `comment.${payload.action}`;
    }
  }

  return {
    triggerId,
    eventType: eventType || undefined,
    payloadSummary: Object.keys(payloadSummary).length > 0 ? payloadSummary : undefined,
  };
}

/**
 * Truncate a string to a maximum length
 */
function truncate(str: string | undefined, maxLength: number): string | undefined {
  if (!str) return undefined;
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}
