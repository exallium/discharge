/**
 * Unit tests for webhook body parsing
 *
 * Tests both JSON and form-encoded (application/x-www-form-urlencoded) payloads
 * that GitHub can send depending on webhook configuration.
 */

import { NextRequest } from 'next/server';

// Import the functions we want to test by re-implementing them here
// (since they're not exported from the route file)
// This also serves as documentation of the expected behavior

/**
 * Parse webhook body - handles both JSON and form-encoded payloads
 */
async function parseWebhookBody(request: NextRequest): Promise<unknown> {
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
    throw new Error('No payload found in form data');
  }

  // Try JSON as fallback
  return request.json();
}

/**
 * Helper to create a mock NextRequest
 */
function createMockNextRequest(
  body: string,
  contentType: string,
  method = 'POST'
): NextRequest {
  return new NextRequest('http://localhost/api/webhooks/github-issues', {
    method,
    headers: {
      'content-type': contentType,
    },
    body,
  });
}

describe('Webhook Body Parsing', () => {
  const samplePayload = {
    action: 'opened',
    issue: {
      number: 42,
      title: 'Test issue',
      body: 'This is a test issue',
    },
    repository: {
      full_name: 'owner/repo',
    },
  };

  describe('JSON content type (application/json)', () => {
    it('should parse JSON body correctly', async () => {
      const request = createMockNextRequest(
        JSON.stringify(samplePayload),
        'application/json'
      );

      const result = await parseWebhookBody(request);

      expect(result).toEqual(samplePayload);
    });

    it('should handle JSON with charset specification', async () => {
      const request = createMockNextRequest(
        JSON.stringify(samplePayload),
        'application/json; charset=utf-8'
      );

      const result = await parseWebhookBody(request);

      expect(result).toEqual(samplePayload);
    });

    it('should throw on invalid JSON', async () => {
      const request = createMockNextRequest(
        'not valid json',
        'application/json'
      );

      await expect(parseWebhookBody(request)).rejects.toThrow();
    });
  });

  describe('Form-encoded content type (application/x-www-form-urlencoded)', () => {
    it('should parse form-encoded payload correctly', async () => {
      const encodedPayload = `payload=${encodeURIComponent(JSON.stringify(samplePayload))}`;
      const request = createMockNextRequest(
        encodedPayload,
        'application/x-www-form-urlencoded'
      );

      const result = await parseWebhookBody(request);

      expect(result).toEqual(samplePayload);
    });

    it('should handle special characters in payload', async () => {
      const payloadWithSpecialChars = {
        ...samplePayload,
        issue: {
          ...samplePayload.issue,
          body: 'Test with special chars: <script>alert("xss")</script> & "quotes" = 100%',
        },
      };
      const encodedPayload = `payload=${encodeURIComponent(JSON.stringify(payloadWithSpecialChars))}`;
      const request = createMockNextRequest(
        encodedPayload,
        'application/x-www-form-urlencoded'
      );

      const result = await parseWebhookBody(request);

      expect(result).toEqual(payloadWithSpecialChars);
    });

    it('should handle unicode characters in payload', async () => {
      const payloadWithUnicode = {
        ...samplePayload,
        issue: {
          ...samplePayload.issue,
          title: 'Bug: 日本語タイトル 🐛',
          body: 'Description with émojis 🎉 and ñ characters',
        },
      };
      const encodedPayload = `payload=${encodeURIComponent(JSON.stringify(payloadWithUnicode))}`;
      const request = createMockNextRequest(
        encodedPayload,
        'application/x-www-form-urlencoded'
      );

      const result = await parseWebhookBody(request);

      expect(result).toEqual(payloadWithUnicode);
    });

    it('should throw when payload parameter is missing', async () => {
      const request = createMockNextRequest(
        'other_param=value',
        'application/x-www-form-urlencoded'
      );

      await expect(parseWebhookBody(request)).rejects.toThrow('No payload found in form data');
    });

    it('should throw when payload is invalid JSON', async () => {
      const request = createMockNextRequest(
        'payload=not%20valid%20json',
        'application/x-www-form-urlencoded'
      );

      await expect(parseWebhookBody(request)).rejects.toThrow();
    });
  });

  describe('Fallback behavior', () => {
    it('should try JSON parsing for unknown content types', async () => {
      const request = createMockNextRequest(
        JSON.stringify(samplePayload),
        'text/plain'
      );

      const result = await parseWebhookBody(request);

      expect(result).toEqual(samplePayload);
    });

    it('should try JSON parsing when content-type is missing', async () => {
      const request = new NextRequest('http://localhost/api/webhooks/github-issues', {
        method: 'POST',
        body: JSON.stringify(samplePayload),
      });

      const result = await parseWebhookBody(request);

      expect(result).toEqual(samplePayload);
    });
  });
});

describe('GitHub Webhook Scenarios', () => {
  // Real-world GitHub webhook payloads

  const issueOpenedPayload = {
    action: 'opened',
    issue: {
      number: 123,
      title: 'Bug: Application crashes on startup',
      body: '## Description\nThe app crashes when...\n\n## Steps to Reproduce\n1. Start the app\n2. Click button',
      state: 'open',
      user: { login: 'reporter' },
      labels: [{ name: 'bug' }, { name: 'ai-fix' }],
      html_url: 'https://github.com/owner/repo/issues/123',
    },
    repository: {
      full_name: 'owner/repo',
      name: 'repo',
      owner: { login: 'owner' },
    },
    sender: { login: 'reporter' },
  };

  it('should parse GitHub issue opened event as JSON', async () => {
    const request = createMockNextRequest(
      JSON.stringify(issueOpenedPayload),
      'application/json'
    );

    const result = await parseWebhookBody(request);

    expect(result).toEqual(issueOpenedPayload);
    expect((result as typeof issueOpenedPayload).action).toBe('opened');
    expect((result as typeof issueOpenedPayload).issue.number).toBe(123);
  });

  it('should parse GitHub issue opened event as form-encoded', async () => {
    const encodedPayload = `payload=${encodeURIComponent(JSON.stringify(issueOpenedPayload))}`;
    const request = createMockNextRequest(
      encodedPayload,
      'application/x-www-form-urlencoded'
    );

    const result = await parseWebhookBody(request);

    expect(result).toEqual(issueOpenedPayload);
    expect((result as typeof issueOpenedPayload).action).toBe('opened');
    expect((result as typeof issueOpenedPayload).issue.number).toBe(123);
  });

  it('should handle large payloads (issue with long body)', async () => {
    const largeBody = 'A'.repeat(10000); // 10KB body
    const largePayload = {
      ...issueOpenedPayload,
      issue: {
        ...issueOpenedPayload.issue,
        body: largeBody,
      },
    };

    // Test JSON
    const jsonRequest = createMockNextRequest(
      JSON.stringify(largePayload),
      'application/json'
    );
    const jsonResult = await parseWebhookBody(jsonRequest);
    expect((jsonResult as typeof largePayload).issue.body).toBe(largeBody);

    // Test form-encoded
    const encodedPayload = `payload=${encodeURIComponent(JSON.stringify(largePayload))}`;
    const formRequest = createMockNextRequest(
      encodedPayload,
      'application/x-www-form-urlencoded'
    );
    const formResult = await parseWebhookBody(formRequest);
    expect((formResult as typeof largePayload).issue.body).toBe(largeBody);
  });
});
