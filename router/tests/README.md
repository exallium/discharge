# Testing Guide

## Overview

This project uses Jest for testing with comprehensive unit, integration, and end-to-end tests.

## Test Structure

```
tests/
├── unit/              # Unit tests for individual components
│   ├── sources/       # Source plugin tests
│   └── webhooks/      # Webhook handler tests
│
├── integration/       # Integration tests (require Docker)
│   └── webhook-flow.test.ts
│
├── fixtures/          # Test data fixtures
│   └── webhook-payloads.ts
│
├── mocks/             # Mock implementations
│   └── mock-source.ts
│
├── helpers/           # Test utilities
│   ├── app.ts         # Express test helpers
│   ├── docker.ts      # Docker utilities
│   └── integration.ts # Integration test setup
│
└── setup.ts           # Global test setup
```

## Running Tests

### Prerequisites

```bash
# Install dependencies
npm install
```

### Unit Tests Only

```bash
# Run all unit tests
npm test

# Run in watch mode
npm run test:watch

# Run with coverage
npm run test:coverage
```

### Integration Tests

Integration tests require Docker to be running.

```bash
# Start test infrastructure
docker compose -f ../docker-compose.test.yml up -d

# Run integration tests
npm run test:integration

# Stop test infrastructure
docker compose -f ../docker-compose.test.yml down -v
```

### All Tests

```bash
# Run all tests (unit + integration)
npm test
```

## Test Infrastructure

### Docker Compose for Testing

The `docker-compose.test.yml` provides:
- **Redis** on port 6380 (separate from production Redis on 6379)
- **Mock HTTP service** for testing external API calls

### Mock Source Plugin

The `MockSource` class (`tests/mocks/mock-source.ts`) provides a fully functional source plugin for testing:

```typescript
import { createMockSource } from './mocks/mock-source';

const source = createMockSource();

// Configure behavior
source.setValidation(false);
source.setEvent(customEvent);
source.setTools(customTools);

// Assert on calls
expect(source.calls.validateWebhook).toBe(1);
expect(source.lastComment).toEqual({ event, comment });
```

### Test Fixtures

Use pre-defined webhook payloads from `tests/fixtures/webhook-payloads.ts`:

```typescript
import { mockWebhookPayloads } from './fixtures/webhook-payloads';

// Mock source
const payload = mockWebhookPayloads.mock.valid;

// Sentry
const sentryPayload = mockWebhookPayloads.sentry.issueCreated;

// GitHub
const githubPayload = mockWebhookPayloads.github.issueOpened;

// CircleCI
const circleciPayload = mockWebhookPayloads.circleci.jobFailed;
```

## Writing Tests

### Unit Test Example

```typescript
import { createMockSource } from '../../mocks/mock-source';

describe('MyComponent', () => {
  let source: MockSource;

  beforeEach(() => {
    source = createMockSource();
  });

  it('should do something', async () => {
    const result = await source.validateWebhook({} as any);
    expect(result).toBe(true);
  });
});
```

### Integration Test Example

```typescript
import { createTestEnvironment, skipIfNoDocker } from '../helpers/integration';

describe('Integration Test', () => {
  const env = createTestEnvironment();

  skipIfNoDocker();

  beforeAll(async () => {
    await env.setup();
  }, 60000);

  afterAll(async () => {
    await env.teardown();
  }, 30000);

  it('should work with Redis', async () => {
    const redis = env.getRedis();
    await redis.set('key', 'value');
    expect(await redis.get('key')).toBe('value');
  });
});
```

### Webhook Flow Test Example

```typescript
import request from 'supertest';
import { createTestApp } from '../helpers/app';

describe('Webhook Handler', () => {
  const app = createTestApp();

  it('should accept valid webhook', async () => {
    const response = await request(app)
      .post('/webhooks/mock')
      .send({ issueId: '123' })
      .expect(202);

    expect(response.body.queued).toBe(true);
  });
});
```

## Continuous Integration

Tests run automatically on:
- Push to any branch
- Pull request creation
- Pull request updates

### CI Configuration

```yaml
# .github/workflows/test.yml
name: Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      redis:
        image: redis:7-alpine
        ports:
          - 6380:6379
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 20
      - run: npm install
      - run: npm test
```

## Coverage

View coverage reports:

```bash
npm run test:coverage

# Open HTML report
open coverage/lcov-report/index.html
```

Target: **>80% coverage** for critical paths

## Debugging Tests

### Run specific test file

```bash
npm test -- webhook-router.test.ts
```

### Run specific test

```bash
npm test -- -t "should process valid webhook"
```

### Debug in VS Code

Add to `.vscode/launch.json`:

```json
{
  "type": "node",
  "request": "launch",
  "name": "Jest Debug",
  "program": "${workspaceFolder}/node_modules/.bin/jest",
  "args": ["--runInBand", "--no-cache"],
  "console": "integratedTerminal",
  "internalConsoleOptions": "neverOpen"
}
```

## Best Practices

1. **Isolate tests**: Each test should be independent
2. **Use fixtures**: Reuse test data from `fixtures/`
3. **Mock external services**: Don't call real APIs in tests
4. **Test behavior, not implementation**: Focus on what, not how
5. **Keep tests fast**: Unit tests should run in milliseconds
6. **Clean up**: Always restore state after tests
7. **Use descriptive names**: Test names should explain what is being tested

## Troubleshooting

### Tests hang or timeout

- Check Docker containers are running: `docker ps`
- Ensure Redis is accessible: `redis-cli -p 6380 ping`
- Increase timeout in test: `jest.setTimeout(30000)`

### Port conflicts

- Test Redis uses port 6380
- If conflicts occur, modify `docker-compose.test.yml`

### Integration tests skipped

- Verify Docker is installed and running
- Check Docker daemon is accessible: `docker info`
- Integration tests auto-skip if Docker unavailable
