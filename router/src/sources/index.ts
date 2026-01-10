import { SourcePlugin } from './base';

/**
 * Registry of all available source plugins
 * Add new sources here as they are implemented
 */
export const sources: SourcePlugin[] = [
  // Sources will be added here as they are implemented
  // new SentrySource(),
  // new GitHubIssuesSource(),
  // new CircleCISource(),
];

/**
 * Get a source plugin by its ID
 */
export function getSourceById(id: string): SourcePlugin | undefined {
  return sources.find(s => s.id === id);
}

/**
 * Get a source plugin by its type
 */
export function getSourceByType(type: string): SourcePlugin | undefined {
  return sources.find(s => s.type === type);
}

/**
 * List all registered source IDs
 */
export function listSourceIds(): string[] {
  return sources.map(s => s.id);
}
