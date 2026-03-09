/**
 * Kanban/CLI Service Types
 */

/**
 * Request body for CLI job submission
 */
export interface KanbanJobRequest {
  projectId: string;
  title: string;
  description?: string;
  mode?: 'triage' | 'investigate';
  skipPR?: boolean;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  gitAuthor?: {
    name: string;
    email: string;
  };
}

/**
 * Metadata attached to CLI/kanban trigger events
 */
export interface KanbanMetadata {
  source: 'cli';
  skipPR: boolean;
  executionMode: 'local';
  mode?: 'triage' | 'investigate';
  gitAuthor?: {
    name: string;
    email: string;
  };
  [key: string]: unknown;
}
