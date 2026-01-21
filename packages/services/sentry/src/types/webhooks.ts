/**
 * Sentry webhook payload types
 * Based on Sentry Webhook Integration documentation
 */

/**
 * Sentry Tag
 */
export interface SentryTag {
  key: string;
  value: string;
}

/**
 * Sentry Issue Metadata
 */
export interface SentryIssueMetadata {
  value?: string;
  type?: string;
  filename?: string;
  function?: string;
}

/**
 * Sentry Project
 */
export interface SentryProject {
  id: string;
  name: string;
  slug: string;
  platform?: string;
}

/**
 * Sentry Issue
 */
export interface SentryIssue {
  id: string;
  shortId?: string;
  title: string;
  culprit?: string;
  level: 'fatal' | 'error' | 'warning' | 'info' | 'debug';
  status: 'unresolved' | 'resolved' | 'ignored';
  platform?: string;
  metadata: SentryIssueMetadata;
  tags: SentryTag[];
  count?: number;
  userCount?: number;
  firstSeen?: string;
  lastSeen?: string;
  permalink?: string;
}

/**
 * Sentry Event (occurrence)
 */
export interface SentryEvent {
  eventID: string;
  message?: string;
  dateCreated?: string;
  context?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  tags?: SentryTag[];
  user?: {
    id?: string;
    email?: string;
    username?: string;
    ipAddress?: string;
  };
  sdk?: {
    name?: string;
    version?: string;
  };
}

/**
 * Sentry Webhook Data
 */
export interface SentryWebhookData {
  issue?: SentryIssue;
  event?: SentryEvent;
  project?: SentryProject;
}

/**
 * Sentry Webhook Payload
 */
export interface SentryWebhookPayload {
  action: 'created' | 'resolved' | 'assigned' | 'ignored' | 'unresolved';
  data: SentryWebhookData;
  installation?: {
    uuid: string;
  };
  actor?: {
    type: 'user' | 'application';
    id?: string;
    name?: string;
  };
}

/**
 * Type guard for issue created event
 */
export function isIssueCreatedEvent(payload: SentryWebhookPayload): boolean {
  return payload.action === 'created' && !!payload.data?.issue;
}

/**
 * Sentry event data types for prefetch
 */
export interface SentryStackFrame {
  filename?: string;
  absPath?: string;
  function?: string;
  lineNo?: number;
  colNo?: number;
  context?: Array<[number, string]>;
}

export interface SentryException {
  type: string;
  value: string;
  stacktrace?: {
    frames: SentryStackFrame[];
  };
}

export interface SentryBreadcrumb {
  timestamp?: number;
  category?: string;
  message?: string;
  data?: {
    url?: string;
    to?: string;
    [key: string]: unknown;
  };
}

export interface SentryExceptionEntry {
  type: 'exception';
  data?: {
    values?: SentryException[];
  };
}

export interface SentryBreadcrumbEntry {
  type: 'breadcrumbs';
  data?: {
    values?: SentryBreadcrumb[];
  };
}

export interface SentryRequestEntry {
  type: 'request';
  data?: {
    method?: string;
    url?: string;
    headers?: Record<string, string>;
    [key: string]: unknown;
  };
}

export type SentryEntry = SentryExceptionEntry | SentryBreadcrumbEntry | SentryRequestEntry | {
  type: string;
  data?: unknown;
};

export interface SentryEventData {
  eventID: string;
  dateCreated?: string;
  entries?: SentryEntry[];
  tags?: Array<{ key: string; value: string }>;
  contexts?: Record<string, unknown>;
}
