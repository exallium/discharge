import { Request } from 'express';

/**
 * Normalized event from any bug tracking source
 */
export interface SourceEvent {
  // Core identification
  sourceType: string;           // 'sentry', 'github-issues', etc.
  sourceId: string;              // Issue ID, event ID, job ID, etc.
  projectId: string;             // Which project config to use

  // Display info
  title: string;
  description: string;

  // Structured metadata
  metadata: {
    severity?: 'low' | 'medium' | 'high' | 'critical';
    tags?: string[];
    environment?: string;
    [key: string]: any;
  };

  // Links
  links?: {
    web?: string;
    api?: string;
  };

  // Raw payload (for tool use)
  raw: any;
}

/**
 * Tool definition for bash scripts dynamically generated per source
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
 * Source plugin interface - all bug sources implement this
 */
export interface SourcePlugin {
  // Identification
  id: string;
  type: string;

  // Webhook handling
  validateWebhook(req: Request): Promise<boolean>;
  parseWebhook(payload: any): Promise<SourceEvent | null>;

  // Tool generation
  getTools(event: SourceEvent): Tool[];

  // Context generation for prompts
  getPromptContext(event: SourceEvent): string;

  // Post-processing
  updateStatus(event: SourceEvent, status: FixStatus): Promise<void>;
  addComment(event: SourceEvent, comment: string): Promise<void>;
  getLink(event: SourceEvent): string;

  // Optional: Pre-filtering
  shouldProcess?(event: SourceEvent): Promise<boolean>;
}
