/**
 * Test fixtures for GitHub webhook payloads
 */

export const mockWebhookPayloads = {
  issueOpened: {
    action: 'opened',
    issue: {
      number: 42,
      title: 'Fix authentication bug',
      body: 'Users cannot log in after recent deploy. Error: "Invalid token"',
      state: 'open',
      html_url: 'https://github.com/owner/repo/issues/42',
      url: 'https://api.github.com/repos/owner/repo/issues/42',
      created_at: '2024-01-10T12:00:00Z',
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
  issueOpenedWithTriggerLabel: {
    action: 'opened',
    issue: {
      number: 43,
      title: 'Memory leak in background worker',
      body: 'Worker process memory grows unbounded over time',
      state: 'open',
      html_url: 'https://github.com/owner/repo/issues/43',
      url: 'https://api.github.com/repos/owner/repo/issues/43',
      created_at: '2024-01-10T12:00:00Z',
      user: {
        login: 'reporter',
      },
      labels: [
        { name: 'bug' },
        { name: 'ai-fix' },  // Trigger label
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
  issueOpenedWithoutLabel: {
    action: 'opened',
    issue: {
      number: 44,
      title: 'Feature request: dark mode',
      body: 'Please add dark mode support',
      state: 'open',
      html_url: 'https://github.com/owner/repo/issues/44',
      url: 'https://api.github.com/repos/owner/repo/issues/44',
      created_at: '2024-01-10T12:00:00Z',
      user: {
        login: 'user123',
      },
      labels: [],  // No labels
    },
    repository: {
      full_name: 'owner/repo',
      name: 'repo',
      owner: {
        login: 'owner',
      },
    },
  },
  issueLabeled: {
    action: 'labeled',
    issue: {
      number: 45,
      title: 'Crash on startup',
      body: 'App crashes immediately when launched',
      state: 'open',
      html_url: 'https://github.com/owner/repo/issues/45',
      url: 'https://api.github.com/repos/owner/repo/issues/45',
      created_at: '2024-01-09T10:00:00Z',
      user: {
        login: 'reporter2',
      },
      labels: [
        { name: 'bug' },
        { name: 'ai-fix' },  // Just added
      ],
    },
    label: {
      name: 'ai-fix',
    },
    repository: {
      full_name: 'owner/repo',
      name: 'repo',
      owner: {
        login: 'owner',
      },
    },
  },
  issueCommentWithTrigger: {
    action: 'created',
    issue: {
      number: 46,
      title: 'Database connection timeout',
      body: 'Connection pool exhausted under load',
      state: 'open',
      html_url: 'https://github.com/owner/repo/issues/46',
      url: 'https://api.github.com/repos/owner/repo/issues/46',
      created_at: '2024-01-09T09:00:00Z',
      user: {
        login: 'reporter3',
      },
      labels: [
        { name: 'bug' },
      ],
    },
    comment: {
      id: 1234567,
      body: '/claude fix\n\nPlease investigate this issue',
      html_url: 'https://github.com/owner/repo/issues/46#issuecomment-1234567',
      user: {
        login: 'maintainer-alice',  // Allowed user
      },
      created_at: '2024-01-10T14:00:00Z',
    },
    repository: {
      full_name: 'owner/repo',
      name: 'repo',
      owner: {
        login: 'owner',
      },
    },
  },
  issueCommentWithoutTrigger: {
    action: 'created',
    issue: {
      number: 46,
      title: 'Database connection timeout',
      body: 'Connection pool exhausted under load',
      state: 'open',
      html_url: 'https://github.com/owner/repo/issues/46',
      url: 'https://api.github.com/repos/owner/repo/issues/46',
      created_at: '2024-01-09T09:00:00Z',
      user: {
        login: 'reporter3',
      },
      labels: [
        { name: 'bug' },
      ],
    },
    comment: {
      id: 1234568,
      body: 'Has anyone looked into this?',
      html_url: 'https://github.com/owner/repo/issues/46#issuecomment-1234568',
      user: {
        login: 'someuser',
      },
      created_at: '2024-01-10T15:00:00Z',
    },
    repository: {
      full_name: 'owner/repo',
      name: 'repo',
      owner: {
        login: 'owner',
      },
    },
  },
  issueCommentUnauthorizedUser: {
    action: 'created',
    issue: {
      number: 47,
      title: 'Performance issue',
      body: 'App is very slow',
      state: 'open',
      html_url: 'https://github.com/owner/repo/issues/47',
      url: 'https://api.github.com/repos/owner/repo/issues/47',
      created_at: '2024-01-10T08:00:00Z',
      user: {
        login: 'reporter4',
      },
      labels: [],
    },
    comment: {
      id: 1234569,
      body: '/claude fix',
      html_url: 'https://github.com/owner/repo/issues/47#issuecomment-1234569',
      user: {
        login: 'random-contributor',  // Not in allowlist
      },
      created_at: '2024-01-10T16:00:00Z',
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
      state: 'open',
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
      state: 'closed',
    },
    repository: {
      full_name: 'owner/repo',
    },
  },
};

/**
 * Create a deep clone of a payload for modification
 */
export function clonePayload<T>(payload: T): T {
  return JSON.parse(JSON.stringify(payload));
}
