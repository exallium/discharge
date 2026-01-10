# Testing Guide

## Overview

This project uses Jest for testing with comprehensive unit, integration, and end-to-end tests.

## Test Structure

```
tests/
├── unit/              # Unit tests (no external dependencies)
│   ├── runner/        # Runner plugin tests (prompts, tools)
│   ├── triggers/      # Trigger plugin tests (sentry, circleci, mock)
│   ├── vcs/           # VCS plugin tests (github)
│   └── webhooks/      # Webhook router tests
│
├── integration/       # Integration tests (require Docker/Redis)
│   ├── claude-runner.test.ts
│   ├── queue.test.ts
│   ├── queue-integration.test.ts
│   └── webhook-flow.test.ts
│
├── fixtures/          # Test data fixtures
│   └── webhook-payloads.ts  # Mock webhook payloads for all triggers
│
├── mocks/             # Mock implementations
│   └── mock-trigger.ts      # Configurable mock trigger for testing
│
├── helpers/           # Test utilities
│   ├── app.ts         # Express test helpers
│   ├── docker.ts      # Docker utilities
│   └── integration.ts # Integration test setup (Docker, Redis)
│
└── setup.ts           # Global test setup (env vars, console mocking)
```

## Running Tests

### Prerequisites

```bash
# Install dependencies
npm install
```

### Unit Tests Only

Unit tests do not require Docker or Redis. They use mocks for all external dependencies.

```bash
# Run only unit tests (skip integration tests)
npm test -- --testPathIgnorePatterns="integration"

# Run in watch mode
npm run test:watch

# Run with coverage
npm run test:coverage
```

### Integration Tests

Integration tests require Docker and Redis to be running.

**Option 1: Using Docker Compose (Recommended)**

```bash
# Start test infrastructure
docker compose -f ../docker-compose.test.yml up -d

# Run only integration tests
npm test -- tests/integration

# Stop test infrastructure
docker compose -f ../docker-compose.test.yml down -v
```

**Option 2: Using Local Redis**

```bash
# Ensure Redis is running on port 6380
redis-server --port 6380

# Run integration tests
npm test -- tests/integration
```

### All Tests

```bash
# Run all tests (unit + integration)
# Note: Integration tests will fail if Docker/Redis is not available
npm test

# Best practice: Run unit tests locally, integration in CI
npm test -- --testPathIgnorePatterns="integration"
```

## Test Infrastructure

### Docker Compose for Testing

The `docker-compose.test.yml` provides:
- **Redis** on port 6380 (separate from production Redis on 6379)
- **Mock HTTP service** for testing external API calls

### Mock Trigger Plugin

The `MockTrigger` class (`tests/mocks/mock-trigger.ts`) provides a fully functional trigger plugin for testing:

```typescript
import { createMockTrigger } from './mocks/mock-trigger';

const trigger = createMockTrigger();

// Configure behavior
trigger.setValidation(false);  // Fail webhook validation
trigger.shouldProcessResult = false;  // Filter events
trigger.setEvent(customEvent);  // Return custom event
trigger.setTools(customTools);  // Return custom tools

// Assert on calls
expect(trigger.calls.validateWebhook).toBe(1);
expect(trigger.calls.parseWebhook).toBe(1);

// Reset between tests
trigger.reset();
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
import { createMockTrigger } from '../../mocks/mock-trigger';

describe('MyComponent', () => {
  let trigger: ReturnType<typeof createMockTrigger>;

  beforeEach(() => {
    trigger = createMockTrigger();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should validate webhook', async () => {
    const result = await trigger.validateWebhook({} as any);
    expect(result).toBe(true);
    expect(trigger.calls.validateWebhook).toBe(1);
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

### General

1. **Isolate tests**: Each test should be independent
2. **Use fixtures**: Reuse test data from `fixtures/`
3. **Mock external services**: Don't call real APIs in tests
4. **Test behavior, not implementation**: Focus on what, not how
5. **Keep tests fast**: Unit tests should run in milliseconds
6. **Clean up**: Always restore state after tests
7. **Use descriptive names**: Test names should explain what is being tested

### Project-Specific Patterns

**Unit Tests vs Integration Tests:**
- **Unit tests** (`tests/unit/`): Mock ALL external dependencies (Redis, Docker, APIs)
- **Integration tests** (`tests/integration/`): Use real infrastructure via Docker Compose

**Mocking Queue Module:**
```typescript
// In unit tests that import webhooks (which imports queue)
jest.mock('../../../src/queue', () => ({
  queueFixJob: jest.fn().mockResolvedValue('mock-job-id'),
  getQueueStats: jest.fn().mockResolvedValue({
    waiting: 0, active: 0, completed: 0,
    failed: 0, delayed: 0, paused: false,
  }),
}));
```

**Global State Cleanup:**
```typescript
// When modifying global arrays (like triggers)
let originalTriggers: TriggerPlugin[];

beforeEach(() => {
  originalTriggers = [...triggers];
  triggers.length = 0;
  triggers.push(mockTrigger);
});

afterEach(() => {
  triggers.length = 0;
  triggers.push(...originalTriggers);
});
```

**Environment Variables:**
```typescript
// Always clean up environment variables
beforeEach(() => {
  process.env.SOME_SECRET = 'test-value';
});

afterEach(() => {
  delete process.env.SOME_SECRET;
  jest.clearAllMocks();
});
```

## Troubleshooting

### Tests hang or timeout

**Symptoms:** Tests exceed 10s timeout, worker processes fail to exit

**Causes:**
- Redis connection attempts in unit tests (should be mocked)
- Missing cleanup in `afterEach`/`afterAll`
- Unclosed connections (Redis, HTTP servers, Docker)

**Solutions:**
```bash
# Run with open handles detection
npm test -- --detectOpenHandles

# Run only unit tests (skip integration)
npm test -- --testPathIgnorePatterns="integration"

# Check for Redis connection attempts
# All queue imports in unit tests must be mocked!
```

### Redis Connection Refused (ECONNREFUSED)

**Symptoms:** `Error: connect ECONNREFUSED 127.0.0.1:6379`

**Causes:**
- Unit test importing queue module without mocking
- Integration test running without Docker/Redis

**Solutions:**
```typescript
// Option 1: Mock the queue module (for unit tests)
jest.mock('../../../src/queue', () => ({
  queueFixJob: jest.fn().mockResolvedValue('job-id'),
  // ... other exports
}));

// Option 2: Use integration test pattern (for integration tests)
import { skipIfNoDocker, createTestEnvironment } from '../helpers/integration';
const env = createTestEnvironment();
skipIfNoDocker();
```

### Port conflicts

- Test Redis uses port 6380 (prod uses 6379)
- If conflicts occur, modify `docker-compose.test.yml`
- Check what's using the port: `lsof -i :6380`

### Integration tests fail with "Docker not available"

**This is expected behavior when Docker isn't running**

**Solutions:**
```bash
# Option 1: Install and start Docker
docker info  # Verify Docker is running

# Option 2: Skip integration tests
npm test -- --testPathIgnorePatterns="integration"

# Option 3: Run only unit tests (recommended for local development)
npm test -- --testPathIgnorePatterns="integration"
```

### Worker process fails to exit gracefully

**Symptoms:** "A worker process has failed to exit gracefully..."

**Causes:**
- Unclosed Redis connections
- Unclosed HTTP servers
- Background timers not cleaned up

**Solutions:**
- Ensure all tests call `closeQueue()` in `afterAll`
- Add `jest.clearAllTimers()` if using timers
- Check for missing `afterEach`/`afterAll` cleanup
