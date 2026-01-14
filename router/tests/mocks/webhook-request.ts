import type { WebhookHeaders, WebhookRequest } from '../../src/triggers/base';

/**
 * Create mock headers that match the WebhookHeaders interface
 * Headers are case-insensitive per HTTP spec
 */
export function createMockHeaders(headers: Record<string, string>): WebhookHeaders {
  const lowercased = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])
  );
  return {
    get: (name: string) => lowercased[name.toLowerCase()] || null,
  };
}

/**
 * Create a mock WebhookRequest for testing
 */
export function createMockWebhookRequest(
  headers: Record<string, string>,
  body: unknown
): WebhookRequest {
  return {
    headers: createMockHeaders(headers),
    body,
  };
}
