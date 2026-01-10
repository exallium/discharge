# Mock Trigger Plugin

A test trigger plugin used for development and testing.

## Overview

The Mock trigger is a simple, configurable trigger plugin used for:
- Testing the trigger plugin system
- Development and debugging
- Writing integration tests
- Demonstrating how to implement a trigger plugin

## Usage

The mock trigger is automatically available in test environments and can be used to simulate webhook events without connecting to a real bug tracking system.

### Basic Example

```typescript
import { createMockTrigger } from './mocks/mock-trigger';

const trigger = createMockTrigger();

// Configure responses
trigger.setValidation(true);
trigger.setEvent({
  triggerType: 'mock',
  triggerId: 'test-123',
  projectId: 'test-project',
  title: 'Test Issue',
  description: 'Test description',
  metadata: {},
  raw: {},
});

// Use in tests
const isValid = await trigger.validateWebhook(req);
const event = await trigger.parseWebhook(payload);
```

## Features

### Configurable Behavior

All methods can be configured to return custom values:

- `setValidation(valid: boolean)` - Control webhook validation result
- `setEvent(event: TriggerEvent | null)` - Set the event returned by parseWebhook
- `setTools(tools: Tool[])` - Set custom investigation tools

### Call Tracking

The mock trigger tracks all method calls for test assertions:

```typescript
expect(trigger.calls.validateWebhook).toBe(1);
expect(trigger.calls.parseWebhook).toBe(1);
expect(trigger.lastStatusUpdate).toEqual({ event, status });
expect(trigger.lastComment).toEqual({ event, comment });
```

### Default Behavior

Without configuration, the mock trigger:
- Validates all webhooks (returns `true`)
- Parses payloads with `issueId` field
- Returns a simple "get-issue" tool
- Processes all events (shouldProcess returns `true`)

## Testing

See `router/tests/unit/triggers/mock-trigger.test.ts` for comprehensive examples.

## Implementation Reference

The mock trigger demonstrates all required methods of the `TriggerPlugin` interface:

- `validateWebhook()` - Webhook signature validation
- `parseWebhook()` - Parse incoming webhook payloads
- `getTools()` - Generate investigation tools for Claude
- `getPromptContext()` - Format context for Claude's prompt
- `updateStatus()` - Update issue status when fixed
- `addComment()` - Add comments to issues
- `getLink()` - Generate markdown links
- `shouldProcess()` - Pre-filter events

## Not for Production

This trigger is for testing only and should not be enabled in production environments.
