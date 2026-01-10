import { Request } from 'express';
import { TriggerPlugin, TriggerEvent, Tool, FixStatus } from '../../src/triggers/base';

/**
 * Mock trigger plugin for testing
 * Implements all required methods with configurable behavior
 */
export class MockTrigger implements TriggerPlugin {
  id = 'mock';
  type = 'mock';

  // Track method calls for assertions
  calls: {
    validateWebhook: number;
    parseWebhook: number;
    getTools: number;
    getPromptContext: number;
    updateStatus: number;
    addComment: number;
    getLink: number;
  } = {
    validateWebhook: 0,
    parseWebhook: 0,
    getTools: 0,
    getPromptContext: 0,
    updateStatus: 0,
    addComment: 0,
    getLink: 0,
  };

  // Store last call arguments
  lastStatusUpdate?: { event: TriggerEvent; status: FixStatus };
  lastComment?: { event: TriggerEvent; comment: string };

  // Configurable responses
  shouldValidate = true;
  eventToReturn: TriggerEvent | null = null;
  toolsToReturn: Tool[] = [];
  shouldProcessResult = true;

  async validateWebhook(req: Request): Promise<boolean> {
    this.calls.validateWebhook++;
    return this.shouldValidate;
  }

  async parseWebhook(payload: any): Promise<TriggerEvent | null> {
    this.calls.parseWebhook++;

    if (this.eventToReturn) {
      return this.eventToReturn;
    }

    // Default behavior: create event from payload
    if (!payload.issueId) {
      return null;
    }

    return {
      triggerType: 'mock',
      triggerId: payload.issueId,
      projectId: payload.projectId || 'test-project',
      title: payload.title || 'Test Issue',
      description: payload.description || 'Test description',
      metadata: {
        severity: payload.severity || 'medium',
        tags: payload.tags || [],
      },
      links: {
        web: `https://mock.example.com/issues/${payload.issueId}`,
      },
      raw: payload,
    };
  }

  getTools(event: TriggerEvent): Tool[] {
    this.calls.getTools++;

    if (this.toolsToReturn.length > 0) {
      return this.toolsToReturn;
    }

    // Default: return a simple mock tool
    return [
      {
        name: 'get-issue',
        description: 'Get issue details',
        script: `#!/bin/bash
echo '{"id":"${event.triggerId}","title":"${event.title}"}'
`,
      },
    ];
  }

  getPromptContext(event: TriggerEvent): string {
    this.calls.getPromptContext++;
    return `**Mock Issue:** ${event.title}\n**ID:** ${event.triggerId}`;
  }

  async updateStatus(event: TriggerEvent, status: FixStatus): Promise<void> {
    this.calls.updateStatus++;
    this.lastStatusUpdate = { event, status };
  }

  async addComment(event: TriggerEvent, comment: string): Promise<void> {
    this.calls.addComment++;
    this.lastComment = { event, comment };
  }

  getLink(event: TriggerEvent): string {
    this.calls.getLink++;
    return `[Mock Issue](${event.links?.web})`;
  }

  async shouldProcess(event: TriggerEvent): Promise<boolean> {
    return this.shouldProcessResult;
  }

  // Helper methods for testing
  reset(): void {
    this.calls = {
      validateWebhook: 0,
      parseWebhook: 0,
      getTools: 0,
      getPromptContext: 0,
      updateStatus: 0,
      addComment: 0,
      getLink: 0,
    };
    this.lastStatusUpdate = undefined;
    this.lastComment = undefined;
  }

  setValidation(valid: boolean): void {
    this.shouldValidate = valid;
  }

  setEvent(event: TriggerEvent | null): void {
    this.eventToReturn = event;
  }

  setTools(tools: Tool[]): void {
    this.toolsToReturn = tools;
  }
}

/**
 * Create a mock trigger instance
 */
export function createMockTrigger(overrides?: Partial<MockTrigger>): MockTrigger {
  const trigger = new MockTrigger();
  if (overrides) {
    Object.assign(trigger, overrides);
  }
  return trigger;
}
