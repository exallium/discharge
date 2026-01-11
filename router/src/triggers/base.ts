import { Request } from 'express';

/**
 * Normalized event from any bug tracking trigger
 */
export interface TriggerEvent {
  // Core identification
  triggerType: string;           // 'sentry', 'github-issues', etc.
  triggerId: string;             // Issue ID, event ID, job ID, etc.
  projectId: string;             // Which project config to use

  // Display info
  title: string;
  description: string;

  // Structured metadata
  metadata: {
    severity?: 'low' | 'medium' | 'high' | 'critical';
    tags?: string[];
    environment?: string;
    [key: string]: unknown;
  };

  // Links
  links?: {
    web?: string;
    api?: string;
  };

  // Raw payload (for tool use)
  raw: unknown;
}

/**
 * Tool definition for bash scripts dynamically generated per trigger
 */
export interface Tool {
  name: string;                  // CLI command name
  script: string;                // Bash script content
  description: string;           // Usage instructions
  env?: Record<string, string>;  // Additional env vars needed
}

/**
 * Result of Claude's analysis
 */
export interface AnalysisResult {
  canAutoFix: boolean;
  confidence: 'high' | 'medium' | 'low';
  summary: string;
  rootCause: string;
  proposedFix?: string;
  reason?: string;
  filesInvolved: string[];
  complexity: 'trivial' | 'simple' | 'moderate' | 'complex';
}

/**
 * Status of a fix attempt
 */
export interface FixStatus {
  fixed: boolean;
  reason?: string;
  analysis?: AnalysisResult;
  prUrl?: string;
}

/**
 * Trigger plugin interface - all bug tracking systems implement this
 */
export interface TriggerPlugin {
  // Identification
  id: string;
  type: string;

  // Webhook handling
  validateWebhook(req: Request): Promise<boolean>;
  parseWebhook(payload: unknown): Promise<TriggerEvent | null>;

  // Tool generation
  getTools(event: TriggerEvent): Tool[];

  // Context generation for prompts
  getPromptContext(event: TriggerEvent): string;

  // Post-processing
  updateStatus(event: TriggerEvent, status: FixStatus): Promise<void>;
  addComment(event: TriggerEvent, comment: string): Promise<void>;
  getLink(event: TriggerEvent): string;

  // Optional: Pre-filtering
  shouldProcess?(event: TriggerEvent): Promise<boolean>;
}
