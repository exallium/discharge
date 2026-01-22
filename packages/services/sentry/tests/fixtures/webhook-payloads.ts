/**
 * Test fixtures for Sentry webhook payloads
 */

export const mockWebhookPayloads = {
  issueCreated: {
    action: 'created',
    data: {
      issue: {
        id: '12345',
        title: 'TypeError: Cannot read property "name" of undefined',
        culprit: 'src/services/user.ts in getUser',
        level: 'error',
        platform: 'javascript',
        permalink: 'https://sentry.io/organizations/my-org/issues/12345/',
        firstSeen: '2024-01-10T12:00:00Z',
        lastSeen: '2024-01-10T12:30:00Z',
        count: 42,
        userCount: 15,
        metadata: {
          type: 'TypeError',
          value: 'Cannot read property "name" of undefined',
          filename: 'src/services/user.ts',
          function: 'getUser',
        },
        tags: [
          { key: 'environment', value: 'production' },
          { key: 'browser', value: 'Chrome' },
        ],
      },
      event: {
        event_id: 'abc123def456',
      },
      project: {
        slug: 'my-app',
        name: 'My Application',
      },
    },
  },
  issueCreatedMinimal: {
    action: 'created',
    data: {
      issue: {
        id: '67890',
        title: 'Error in payment processing',
        level: 'fatal',
        platform: 'python',
        permalink: 'https://sentry.io/organizations/my-org/issues/67890/',
        firstSeen: '2024-01-10T13:00:00Z',
        lastSeen: '2024-01-10T13:00:00Z',
        count: 1,
        userCount: 1,
        metadata: {
          type: 'ValueError',
          value: 'Invalid payment amount: -100',
        },
        tags: [
          { key: 'environment', value: 'staging' },
        ],
      },
      project: {
        slug: 'my-app',
        name: 'My Application',
      },
    },
  },
  issueResolved: {
    action: 'resolved',
    data: {
      issue: {
        id: '12345',
        title: 'Some issue',
      },
      project: {
        slug: 'my-app',
        name: 'My Application',
      },
    },
  },
  issueWithoutProjectSlug: {
    action: 'created',
    data: {
      issue: {
        id: '99999',
        title: 'Test issue',
        level: 'error',
      },
      // Missing project slug - should be rejected
    },
  },
  debugIssue: {
    action: 'created',
    data: {
      issue: {
        id: '11111',
        title: 'Debug message',
        level: 'debug',
        platform: 'javascript',
        permalink: 'https://sentry.io/organizations/my-org/issues/11111/',
        firstSeen: '2024-01-10T14:00:00Z',
        lastSeen: '2024-01-10T14:00:00Z',
        count: 1,
        userCount: 1,
        metadata: {
          value: 'This is a debug message',
        },
        tags: [],
      },
      project: {
        slug: 'my-app',
        name: 'My Application',
      },
    },
  },
};
