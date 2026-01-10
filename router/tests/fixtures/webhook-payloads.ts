/**
 * Test fixtures for webhook payloads
 */

export const mockWebhookPayloads = {
  /**
   * Mock source webhook payload
   */
  mock: {
    valid: {
      issueId: 'mock-123',
      projectId: 'test-project',
      title: 'NullPointerException in UserService',
      description: 'UserService.getUser() throws NPE when user not found',
      severity: 'high',
      tags: ['bug', 'backend'],
    },
    minimal: {
      issueId: 'mock-456',
      title: 'Test Issue',
    },
    invalid: {
      // Missing issueId - should be filtered
      title: 'Invalid Issue',
    },
  },

  /**
   * Sentry webhook payload
   */
  sentry: {
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
  },

  /**
   * GitHub Issues webhook payload
   */
  github: {
    issueOpened: {
      action: 'opened',
      issue: {
        number: 42,
        title: 'Fix authentication bug',
        body: 'Users cannot log in after recent deploy. Error: "Invalid token"',
        user: {
          login: 'testuser',
        },
        labels: [
          { name: 'bug' },
          { name: 'priority-high' },
        ],
      },
      repository: {
        full_name: 'owner/repo',
        name: 'repo',
        owner: {
          login: 'owner',
        },
      },
    },
    issueEdited: {
      action: 'edited',
      issue: {
        number: 42,
        title: 'Updated title',
      },
      repository: {
        full_name: 'owner/repo',
      },
    },
    issueClosed: {
      action: 'closed',
      issue: {
        number: 42,
        title: 'Some issue',
      },
      repository: {
        full_name: 'owner/repo',
      },
    },
  },

  /**
   * CircleCI webhook payload
   */
  circleci: {
    jobFailed: {
      type: 'job-completed',
      id: 'circleci-webhook-123',
      happened_at: '2024-01-10T12:00:00Z',
      job: {
        id: 'job-789',
        name: 'test',
        status: 'failed',
        url: 'https://app.circleci.com/jobs/job-789',
      },
      pipeline: {
        id: 'pipeline-456',
        vcs: {
          branch: 'main',
          revision: 'abc123def456',
        },
      },
      project: {
        slug: 'gh/owner/repo',
        name: 'repo',
      },
    },
    jobSuccess: {
      type: 'job-completed',
      job: {
        id: 'job-790',
        name: 'test',
        status: 'success',
      },
      pipeline: {
        vcs: {
          branch: 'main',
        },
      },
      project: {
        slug: 'gh/owner/repo',
      },
    },
    buildJob: {
      type: 'job-completed',
      job: {
        id: 'job-791',
        name: 'build',
        status: 'failed',
      },
      pipeline: {
        vcs: {
          branch: 'main',
        },
      },
      project: {
        slug: 'gh/owner/repo',
      },
    },
  },
};

/**
 * Create a deep clone of a payload for modification
 */
export function clonePayload<T>(payload: T): T {
  return JSON.parse(JSON.stringify(payload));
}

/**
 * Create a mock payload with overrides
 */
export function createMockPayload(overrides: any = {}): any {
  return {
    ...mockWebhookPayloads.mock.valid,
    ...overrides,
  };
}
