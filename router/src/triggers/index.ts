import { TriggerPlugin } from './base';
import { SentryTrigger } from './sentry';

/**
 * Registry of all available trigger plugins
 * Add new triggers here as they are implemented
 */
export const triggers: TriggerPlugin[] = [
  new SentryTrigger(),
  // new GitHubIssuesTrigger(),
  // new CircleCITrigger(),
];

/**
 * Get a trigger plugin by its ID
 */
export function getTriggerById(id: string): TriggerPlugin | undefined {
  return triggers.find(t => t.id === id);
}

/**
 * Get a trigger plugin by its type
 */
export function getTriggerByType(type: string): TriggerPlugin | undefined {
  return triggers.find(t => t.type === type);
}

/**
 * List all registered trigger IDs
 */
export function listTriggerIds(): string[] {
  return triggers.map(t => t.id);
}
