import { Request } from 'express';
import { SourcePlugin, SourceEvent, Tool, FixStatus } from '../../src/sources/base';

/**
 * Mock source plugin for testing
 * Implements all required methods with configurable behavior
 */
export class MockSource implements SourcePlugin {
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
  lastStatusUpdate?: { event: SourceEvent; status: FixStatus };
  lastComment?: { event: SourceEvent; comment: string };

  // Configurable responses
  shouldValidate = true;
  eventToReturn: SourceEvent | null = null;
  toolsToReturn: Tool[] = [];
  shouldProcessResult = true;

  async validateWebhook(req: Request): Promise<boolean> {
    this.calls.validateWebhook++;
    return this.shouldValidate;
  }

  async parseWebhook(payload: any): Promise<SourceEvent | null> {
    this.calls.parseWebhook++;

    if (this.eventToReturn) {
      return this.eventToReturn;
    }

    // Default behavior: create event from payload
    if (!payload.issueId) {
      return null;
    }

    return {
      sourceType: 'mock',
      sourceId: payload.issueId,
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

  getTools(event: SourceEvent): Tool[] {
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
echo '{"id":"${event.sourceId}","title":"${event.title}"}'
`,
      },
    ];
  }

  getPromptContext(event: SourceEvent): string {
    this.calls.getPromptContext++;
    return `**Mock Issue:** ${event.title}\n**ID:** ${event.sourceId}`;
  }

  async updateStatus(event: SourceEvent, status: FixStatus): Promise<void> {
    this.calls.updateStatus++;
    this.lastStatusUpdate = { event, status };
  }

  async addComment(event: SourceEvent, comment: string): Promise<void> {
    this.calls.addComment++;
    this.lastComment = { event, comment };
  }

  getLink(event: SourceEvent): string {
    this.calls.getLink++;
    return `[Mock Issue](${event.links?.web})`;
  }

  async shouldProcess(event: SourceEvent): Promise<boolean> {
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

  setEvent(event: SourceEvent | null): void {
    this.eventToReturn = event;
  }

  setTools(tools: Tool[]): void {
    this.toolsToReturn = tools;
  }
}

/**
 * Create a mock source instance
 */
export function createMockSource(overrides?: Partial<MockSource>): MockSource {
  const source = new MockSource();
  if (overrides) {
    Object.assign(source, overrides);
  }
  return source;
}
