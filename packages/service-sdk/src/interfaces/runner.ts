/**
 * Runner Plugin Interface
 *
 * Runners execute AI agents (Claude Code, OpenAI, custom LLMs) to investigate
 * and fix bugs. Each runner implements a standard interface for execution.
 */

import type { Tool, AnalysisResult, SecretRequirement } from './trigger';
import type {
  ConversationMessage,
  RouteMode,
  PlanFile,
  RunnerConversationResult,
  RunnerErrorType,
} from '../types/conversation';

// Re-export for convenience
export type { AnalysisResult };

/**
 * Triage result from the triage agent
 */
export interface TriageResult {
  /** Whether this issue is actionable */
  actionable: boolean;

  /** True for obvious fixes (null pointer, typos, etc.) - skips investigation */
  trivial?: boolean;

  /** Complexity assessment */
  complexity?: 'simple' | 'complex';

  /** Reasoning for the assessment */
  reasoning: string;

  /** Suggested agent to handle this issue */
  suggestedAgent?: string;

  /** For non-actionable issues: the reason */
  reason?: 'duplicate' | 'needs-info' | 'out-of-scope' | 'wont-fix';

  /** Comment to post for non-actionable issues */
  comment?: string;

  /** Category of the issue */
  category?: string;

  /** Confidence score (0-1) */
  confidence?: number;

  /** Labels to add to the issue */
  labels?: string[];
}

/**
 * Investigation context from the investigate agent
 */
export interface InvestigationContext {
  /** Root cause analysis from investigation */
  rootCause: string;

  /** Files identified during investigation */
  filesInvolved: string[];

  /** Suggested approach for fixing */
  suggestedApproach: string;

  /** Full investigation summary */
  summary?: string;

  /** Complexity assessment from investigation */
  complexity?: 'simple' | 'complex';

  /** Recommended agent for the fix */
  recommendedAgent?: string;
}

/**
 * Options for running an AI agent
 */
export interface RunOptions {
  repoUrl: string;           // Git repository URL
  branch: string;            // Branch to check out
  prompt: string;            // Investigation prompt
  tools?: Tool[];            // Investigation tools
  timeoutMs?: number;        // Execution timeout (default: 600000 = 10 min)
  env?: Record<string, string>; // Environment variables
  eventLabels?: string[];    // Labels from trigger event (for category matching)
  projectId?: string;        // Project ID for looking up secrets

  // CLI/kanban mode options
  skipPush?: boolean;        // Skip git push origin (branch stays local)
  skipCleanup?: boolean;     // Skip worktree removal after completion (mark 'completed' instead)
  localRepoPath?: string;    // Path to local repo for worktree creation (instead of remote clone)
  worktreeCommand?: string;  // Custom script to create worktree
  copyFiles?: string[];      // Untracked files to copy from local repo into worktree
  passThroughMcpServers?: boolean; // Merge user's ~/.claude/settings.json MCP servers
  gitAuthor?: { name: string; email: string }; // Custom git commit author
}

/**
 * Result from AI agent execution
 */
export interface RunResult {
  success: boolean;          // Whether execution succeeded
  jobId: string;             // Unique job identifier
  output: string;            // Agent's stdout output
  hasCommit: boolean;        // Whether a commit was made
  branchName?: string;       // Fix branch name (if commit made)
  analysis?: AnalysisResult; // Parsed analysis.json (if exists)
  triageResult?: TriageResult; // Parsed triage-result.json (if exists)
  investigationResult?: InvestigationContext; // Parsed investigation.json (if exists)
  error?: string;            // Error message (if failed)
  errorType?: RunnerErrorType;           // Error classification
  requiresAdminIntervention?: boolean;   // Whether admin action is needed
}

/**
 * Options for running in conversation mode
 */
export interface ConversationRunOptions extends RunOptions {
  conversationHistory: ConversationMessage[];  // Previous messages in conversation
  routeMode: RouteMode;                        // 'plan_review' | 'auto_execute' | 'assist_only'
  iteration: number;                           // Current iteration number
  issueNumber?: number | string;               // Issue/ticket number for plan metadata
  existingPlan?: PlanFile;                     // Existing plan to iterate on
  workspacePath?: string;                      // Pre-prepared workspace (from RepoManager)
  existingPrNumber?: number;                   // Existing PR number (for PR review responses)
  existingPrBranch?: string;                   // Existing PR branch name (for pushing updates)
  defaultBranch?: string;                      // Default branch to fall back to if existingPrBranch is gone
}

/**
 * Runner Plugin Interface
 *
 * Implement this interface to add support for different AI agents:
 * - ClaudeCode (official, Docker-based)
 * - OpenAI Codex/GPT-4
 * - Custom LLMs
 * - Other AI coding assistants
 */
export interface RunnerPlugin {
  // Identification
  id: string;                // Unique identifier (e.g., 'claude-code')
  type: string;              // Runner type (e.g., 'claude-code', 'openai')
  name: string;              // Display name (e.g., 'Claude Code')

  /**
   * Get the secrets required by this runner
   */
  getRequiredSecrets(): SecretRequirement[];

  /**
   * Execute the AI agent
   */
  run(options: RunOptions): Promise<RunResult>;

  /**
   * Check if runner is available
   *
   * Examples:
   * - ClaudeCode: Check Docker is running and image exists
   * - OpenAI: Check API key is set
   * - Custom: Check custom requirements
   */
  isAvailable(): Promise<boolean>;

  /**
   * Validate runner configuration
   */
  validate(): Promise<{ valid: boolean; error?: string }>;

  // ========================================
  // Conversation Mode (Optional)
  // ========================================

  /** Whether this runner supports conversation mode */
  supportsConversation?: boolean;

  /**
   * Execute AI agent in conversation mode
   *
   * Conversation mode provides:
   * - Full conversation history
   * - Existing plan context (if iterating)
   * - Route mode (plan_review, auto_execute, assist_only)
   * - Pre-prepared workspace (optional)
   */
  runConversation?(
    options: ConversationRunOptions
  ): Promise<RunnerConversationResult>;
}
