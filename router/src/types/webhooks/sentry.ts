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
