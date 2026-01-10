import { TriggerPlugin, TriggerEvent, Tool, FixStatus } from '../../src/triggers/base';

export class MockTrigger implements TriggerPlugin {
  id = 'mock';
  type = 'mock';

  async validateWebhook(): Promise<boolean> {
    return true;
  }

  async parseWebhook(payload: any): Promise<TriggerEvent | null> {
    return {
      triggerType: 'mock',
      triggerId: payload.id || 'test-123',
      projectId: payload.projectId || 'test-project',
      title: payload.title || 'Test Issue',
      description: payload.description || 'Test Description',
      metadata: payload.metadata || {},
      raw: payload,
    };
  }

  async shouldProcess(): Promise<boolean> {
    return true;
  }

  getTools(event: TriggerEvent): Tool[] {
    return [];
  }

  getPromptContext(event: TriggerEvent): string {
    return `**Issue ID:** ${event.triggerId}\n**Title:** ${event.title}\n**Description:** ${event.description}`;
  }

  getLink(event: TriggerEvent): string {
    return `https://example.com/issues/${event.triggerId}`;
  }

  async updateStatus(event: TriggerEvent, status: FixStatus): Promise<void> {
    // Mock implementation
  }

  async addComment(event: TriggerEvent, comment: string): Promise<void> {
    // Mock implementation
  }
}

export function createMockTrigger(): MockTrigger {
  return new MockTrigger();
}
