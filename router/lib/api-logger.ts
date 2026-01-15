/**
 * API request logging utilities
 *
 * Provides a wrapper for Next.js route handlers that logs requests to the database
 * with webhook-specific context extraction.
 */

import { NextRequest, NextResponse } from 'next/server';
import { apiLogsRepo, ApiLogDetails } from '@/src/db/repositories';
import { ApiLogOutcome } from '@/src/db/schema';
import { logger, generateRequestId } from '@/src/logger';

/**
 * Context extracted from webhook requests
 */
export interface LoggingContext {
  triggerId?: string;
  eventType?: string;
  payloadSummary?: Record<string, unknown>;
  // Enhanced tracking
  outcome?: ApiLogOutcome;
  outcomeReason?: string;
  jobId?: string;
  projectId?: string;
  details?: ApiLogDetails;
}

/**
 * Helper to set logging context from within route handlers
 * Attaches context to the request for later retrieval
 */
const REQUEST_CONTEXT_KEY = Symbol('loggingContext');

export function setLoggingContext(request: NextRequest, context: Partial<LoggingContext>): void {
  const existing = (request as unknown as Record<symbol, LoggingContext>)[REQUEST_CONTEXT_KEY] || {};
  (request as unknown as Record<symbol, LoggingContext>)[REQUEST_CONTEXT_KEY] = {
    ...existing,
    ...context,
    details: { ...existing.details, ...context.details },
  };
}

export function getLoggingContext(request: NextRequest): LoggingContext {
  return (request as unknown as Record<symbol, LoggingContext>)[REQUEST_CONTEXT_KEY] || {};
}

/**
 * Get the request ID from a request (set by withLogging wrapper)
 */
const REQUEST_ID_KEY = Symbol('requestId');

export function getRequestId(request: NextRequest): string {
  return (request as unknown as Record<symbol, string>)[REQUEST_ID_KEY] || 'unknown';
}

function setRequestId(request: NextRequest, requestId: string): void {
  (request as unknown as Record<symbol, string>)[REQUEST_ID_KEY] = requestId;
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
 * Parse request body - handles both JSON and form-encoded payloads
 */
async function parseRequestBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    return request.json();
  }

  if (contentType.includes('application/x-www-form-urlencoded')) {
    const text = await request.text();
    const params = new URLSearchParams(text);
    const payload = params.get('payload');
    if (payload) {
      return JSON.parse(payload);
    }
    return null;
  }

  // Try JSON as fallback
  return request.json();
}

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

    // Attach requestId to request for use in handlers
    setRequestId(request, requestId);

    let responseStatus = 500;
    let error: string | null = null;
    let loggingContext: LoggingContext = {};

    try {
      // Try to extract context from request body for POST/PUT/PATCH
      if (extractContext && ['POST', 'PUT', 'PATCH'].includes(method)) {
        try {
          const clonedRequest = request.clone();
          const body = await parseRequestBody(clonedRequest);
          loggingContext = extractContext(request, body);
        } catch {
          // Body might not be parseable, continue without context
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

      // Merge in any context set by the handler
      const handlerContext = getLoggingContext(request);
      loggingContext = { ...loggingContext, ...handlerContext };

      // Determine outcome from status code if not explicitly set
      const outcome = loggingContext.outcome || inferOutcome(responseStatus, loggingContext);

      // Log to database (async, don't block response)
      apiLogsRepo
        .create({
          requestId,
          method,
          path,
          statusCode: responseStatus,
          responseTimeMs,
          ipAddress: getClientIp(request),
          userAgent: request.headers.get('user-agent'),
          triggerId: loggingContext.triggerId || null,
          eventType: loggingContext.eventType || null,
          payloadSummary: loggingContext.payloadSummary || null,
          outcome,
          outcomeReason: loggingContext.outcomeReason || null,
          jobId: loggingContext.jobId || null,
          projectId: loggingContext.projectId || null,
          details: loggingContext.details || null,
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
        outcome,
        outcomeReason: loggingContext.outcomeReason,
        triggerId: loggingContext.triggerId,
        eventType: loggingContext.eventType,
        jobId: loggingContext.jobId,
        projectId: loggingContext.projectId,
      });
    }
  };
}

/**
 * Infer outcome from status code when not explicitly set
 */
function inferOutcome(statusCode: number, context: LoggingContext): ApiLogOutcome {
  if (context.jobId) return 'queued';
  if (statusCode >= 200 && statusCode < 300) return 'success';
  if (statusCode === 401) return 'validation_failed';
  if (statusCode === 404) return 'not_found';
  if (statusCode >= 400 && statusCode < 500) return 'filtered';
  return 'error';
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
