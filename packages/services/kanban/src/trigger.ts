/**
 * Kanban Trigger Plugin
 *
 * Handles CLI-submitted tasks via API endpoints.
 * Does not use webhooks from external services — instead validates
 * Bearer token auth and parses CLI payloads into TriggerEvents.
 */

import type {
  TriggerPlugin,
  TriggerEvent,
  FixStatus,
  Tool,
  WebhookRequest,
  WebhookConfig,
  SecretRequirement,
} from '@discharge/service-sdk';
import type { KanbanJobRequest, KanbanMetadata } from './types';

export class KanbanTrigger implements TriggerPlugin {
  id = 'kanban';
  type = 'kanban';

  webhookConfig: WebhookConfig = {
    events: ['cli.push'],
    docsUrl: '',
  };

  /**
   * Validate incoming request via Bearer token
   */
  async validateWebhook(req: WebhookRequest): Promise<boolean> {
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return false;
    }
    // Token validation is handled by the API middleware, not here
    return true;
  }

  /**
   * Parse CLI payload into a TriggerEvent
   */
  async parseWebhook(payload: unknown): Promise<TriggerEvent | null> {
    const body = payload as KanbanJobRequest;
    if (!body?.projectId || !body?.title) {
      return null;
    }

    const metadata: KanbanMetadata = {
      source: 'cli',
      skipPR: body.skipPR ?? true,
      executionMode: 'local',
      mode: body.mode,
      severity: body.severity,
      gitAuthor: body.gitAuthor,
    };

    return {
      triggerType: 'kanban',
      triggerId: `cli-${Date.now()}`,
      projectId: body.projectId,
      title: body.title,
      description: body.description || body.title,
      metadata,
      raw: payload,
    };
  }

  /**
   * No tools needed for CLI jobs
   */
  async getTools(_event: TriggerEvent): Promise<Tool[]> {
    return [];
  }

  /**
   * Build prompt context from the CLI task description
   */
  getPromptContext(event: TriggerEvent): string {
    return `**Title:** ${event.title}\n\n**Description:** ${event.description}`;
  }

  /**
   * No-op: CLI polls for status via API
   */
  async updateStatus(_event: TriggerEvent, _status: FixStatus): Promise<void> {
    // No-op — CLI polls for status
  }

  /**
   * No-op: CLI polls for updates
   */
  async addComment(_event: TriggerEvent, _comment: string): Promise<void> {
    // No-op — CLI polls for updates
  }

  /**
   * No link for CLI tasks
   */
  getLink(_event: TriggerEvent): string {
    return '';
  }

  /**
   * No secrets required (auth handled via API token middleware)
   */
  getRequiredSecrets(): SecretRequirement[] {
    return [];
  }
}
