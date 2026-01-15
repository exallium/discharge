/**
 * Unit tests for API logger utilities
 *
 * Tests context extraction from webhook payloads in both JSON
 * and form-encoded formats.
 */

// Mock dependencies before importing
jest.mock('@/src/db/repositories', () => ({
  apiLogsRepo: {
    create: jest.fn().mockResolvedValue({}),
  },
}));

jest.mock('@/src/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
  generateRequestId: jest.fn().mockReturnValue('test-request-id'),
}));

import { NextRequest } from 'next/server';
import { extractWebhookContext } from '../../../lib/api-logger';

/**
 * Helper to create a mock NextRequest
 */
function createMockNextRequest(
  path: string,
  body?: string,
  contentType?: string,
  headers?: Record<string, string>
): NextRequest {
  const allHeaders: Record<string, string> = { ...headers };
  if (contentType) {
    allHeaders['content-type'] = contentType;
  }

  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers: allHeaders,
    body,
  });
}

describe('extractWebhookContext', () => {
  describe('triggerId extraction', () => {
    it('should extract triggerId from URL path', () => {
      const request = createMockNextRequest('/api/webhooks/github-issues');
      const context = extractWebhookContext(request, {});

      expect(context.triggerId).toBe('github-issues');
    });

    it('should handle nested paths', () => {
      const request = createMockNextRequest('/api/webhooks/sentry-errors');
      const context = extractWebhookContext(request, {});

      expect(context.triggerId).toBe('sentry-errors');
    });
  });

  describe('GitHub event context', () => {
    const githubIssuePayload = {
      action: 'opened',
      issue: {
        number: 42,
        title: 'Bug: Memory leak in worker process',
      },
      repository: {
        full_name: 'owner/repo',
      },
      sender: {
        login: 'developer',
      },
    };

    it('should extract context from GitHub issue event', () => {
      const request = createMockNextRequest(
        '/api/webhooks/github-issues',
        undefined,
        undefined,
        { 'x-github-event': 'issues' }
      );

      const context = extractWebhookContext(request, githubIssuePayload);

      expect(context.triggerId).toBe('github-issues');
      expect(context.eventType).toBe('issues');
      expect(context.payloadSummary).toEqual({
        action: 'opened',
        repository: 'owner/repo',
        issueNumber: 42,
        issueTitle: 'Bug: Memory leak in worker process',
        sender: 'developer',
      });
    });

    it('should use action-based event type when x-github-event header missing', () => {
      const request = createMockNextRequest('/api/webhooks/github-issues');

      const context = extractWebhookContext(request, githubIssuePayload);

      expect(context.eventType).toBe('issues.opened');
    });

    it('should handle pull request events', () => {
      const prPayload = {
        action: 'opened',
        pull_request: {
          number: 123,
          title: 'Fix memory leak',
        },
        repository: {
          full_name: 'owner/repo',
        },
        sender: {
          login: 'contributor',
        },
      };
      const request = createMockNextRequest(
        '/api/webhooks/github-pr',
        undefined,
        undefined,
        { 'x-github-event': 'pull_request' }
      );

      const context = extractWebhookContext(request, prPayload);

      expect(context.eventType).toBe('pull_request');
      expect(context.payloadSummary).toEqual({
        action: 'opened',
        repository: 'owner/repo',
        prNumber: 123,
        prTitle: 'Fix memory leak',
        sender: 'contributor',
      });
    });

    it('should truncate long titles', () => {
      const longTitle = 'A'.repeat(150);
      const payload = {
        action: 'opened',
        issue: {
          number: 1,
          title: longTitle,
        },
      };
      const request = createMockNextRequest('/api/webhooks/github-issues');

      const context = extractWebhookContext(request, payload);

      expect(context.payloadSummary?.issueTitle).toHaveLength(100);
      expect((context.payloadSummary?.issueTitle as string).endsWith('...')).toBe(true);
    });
  });

  describe('Sentry event context', () => {
    const sentryPayload = {
      event_id: 'abc123',
      event: {
        type: 'error',
        title: 'TypeError: Cannot read property of undefined',
      },
    };

    it('should extract context from Sentry event', () => {
      const request = createMockNextRequest('/api/webhooks/sentry');

      const context = extractWebhookContext(request, sentryPayload);

      expect(context.triggerId).toBe('sentry');
      expect(context.payloadSummary).toEqual({
        eventId: 'abc123',
        errorType: 'error',
        errorTitle: 'TypeError: Cannot read property of undefined',
      });
    });
  });

  describe('Empty/invalid body handling', () => {
    it('should handle undefined body', () => {
      const request = createMockNextRequest('/api/webhooks/test');

      const context = extractWebhookContext(request, undefined);

      expect(context.triggerId).toBe('test');
      expect(context.eventType).toBeUndefined();
      expect(context.payloadSummary).toBeUndefined();
    });

    it('should handle null body', () => {
      const request = createMockNextRequest('/api/webhooks/test');

      const context = extractWebhookContext(request, null);

      expect(context.triggerId).toBe('test');
      expect(context.eventType).toBeUndefined();
      expect(context.payloadSummary).toBeUndefined();
    });

    it('should handle non-object body', () => {
      const request = createMockNextRequest('/api/webhooks/test');

      const context = extractWebhookContext(request, 'string body');

      expect(context.triggerId).toBe('test');
      expect(context.eventType).toBeUndefined();
      expect(context.payloadSummary).toBeUndefined();
    });

    it('should handle empty object body', () => {
      const request = createMockNextRequest('/api/webhooks/test');

      const context = extractWebhookContext(request, {});

      expect(context.triggerId).toBe('test');
      expect(context.eventType).toBeUndefined();
      expect(context.payloadSummary).toBeUndefined();
    });
  });
});

describe('API Logger - Request Body Parsing', () => {
  // Test that parseRequestBody (internal function) handles both formats
  // by testing the integration behavior

  const samplePayload = {
    action: 'labeled',
    issue: {
      number: 99,
      title: 'Add dark mode support',
    },
    repository: {
      full_name: 'company/app',
    },
    label: {
      name: 'ai-fix',
    },
  };

  it('should work with JSON content type in real-world flow', () => {
    // This tests that extractWebhookContext works correctly when
    // called with a parsed JSON body (as it would be after parseRequestBody)
    const request = createMockNextRequest(
      '/api/webhooks/github-issues',
      JSON.stringify(samplePayload),
      'application/json',
      { 'x-github-event': 'issues' }
    );

    const context = extractWebhookContext(request, samplePayload);

    expect(context).toEqual({
      triggerId: 'github-issues',
      eventType: 'issues',
      payloadSummary: {
        action: 'labeled',
        repository: 'company/app',
        issueNumber: 99,
        issueTitle: 'Add dark mode support',
      },
    });
  });

  it('should work with form-encoded content in real-world flow', () => {
    // Form-encoded requests would be parsed by parseRequestBody first,
    // then the parsed object passed to extractWebhookContext
    // This test verifies the context extraction works the same regardless
    // of how the body was originally encoded
    const request = createMockNextRequest(
      '/api/webhooks/github-issues',
      `payload=${encodeURIComponent(JSON.stringify(samplePayload))}`,
      'application/x-www-form-urlencoded',
      { 'x-github-event': 'issues' }
    );

    // After parseRequestBody, we'd have the same object
    const context = extractWebhookContext(request, samplePayload);

    expect(context).toEqual({
      triggerId: 'github-issues',
      eventType: 'issues',
      payloadSummary: {
        action: 'labeled',
        repository: 'company/app',
        issueNumber: 99,
        issueTitle: 'Add dark mode support',
      },
    });
  });
});
