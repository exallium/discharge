/**
 * Runner Plugin System - Pluggable AI agent execution
 *
 * Runners execute AI agents (Claude Code, OpenAI, custom LLMs) to investigate
 * and fix bugs. Each runner implements a standard interface for execution.
 */

import { Tool, AnalysisResult, SecretRequirement } from '../triggers/base';
import type {
  ConversationMessage,
  RouteMode,
  PlanFile,
  RunnerConversationResult,
  RunnerErrorType,
} from '../types/conversation';
import type { TriageResult, InvestigationContext } from './bug-config';

// Re-export for convenience
export type { AnalysisResult, TriageResult, InvestigationContext };

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
   *
   * @returns Array of secret requirements
   */
  getRequiredSecrets(): SecretRequirement[];

  /**
   * Execute the AI agent
   *
   * @param options - Execution options
   * @returns Result including analysis and commit status
   */
  run(options: RunOptions): Promise<RunResult>;

  /**
   * Check if runner is available
   *
   * Examples:
   * - ClaudeCode: Check Docker is running and image exists
   * - OpenAI: Check API key is set
   * - Custom: Check custom requirements
   *
   * @returns Whether runner can execute
   */
  isAvailable(): Promise<boolean>;

  /**
   * Validate runner configuration
   *
   * @returns Validation result with error message if invalid
   */
  validate(): Promise<{ valid: boolean; error?: string }>;

  // ========================================
  // Conversation Mode (Optional)
  // ========================================

  /**
   * Whether this runner supports conversation mode
   */
  supportsConversation?: boolean;

  /**
   * Execute AI agent in conversation mode
   *
   * Conversation mode provides:
   * - Full conversation history
   * - Existing plan context (if iterating)
   * - Route mode (plan_review, auto_execute, assist_only)
   * - Pre-prepared workspace (optional)
   *
   * @param options - Conversation run options
   * @returns Conversation result with actions and output
   */
  runConversation?(
    options: ConversationRunOptions
  ): Promise<RunnerConversationResult>;
}

/**
 * Runner registry - stores all registered runner plugins
 */
const runnerPlugins = new Map<string, RunnerPlugin>();

/**
 * Register a runner plugin
 *
 * @param runner - Runner plugin instance
 */
export function registerRunner(runner: RunnerPlugin): void {
  runnerPlugins.set(runner.id, runner);
  console.log(`✓ Registered runner: ${runner.name} (${runner.id})`);
}

/**
 * Get a runner plugin by ID
 *
 * @param id - Runner ID (e.g., 'claude-code', 'openai')
 * @returns Runner plugin or undefined
 */
export function getRunner(id: string): RunnerPlugin | undefined {
  return runnerPlugins.get(id);
}

/**
 * Get all registered runner plugins
 *
 * @returns Array of all runners
 */
export function getAllRunners(): RunnerPlugin[] {
  return Array.from(runnerPlugins.values());
}

/**
 * Validate all registered runners
 *
 * @returns Map of runner ID to validation result
 */
export async function validateAllRunners(): Promise<
  Record<string, { valid: boolean; error?: string }>
> {
  const results: Record<string, { valid: boolean; error?: string }> = {};

  for (const [id, runner] of Array.from(runnerPlugins.entries())) {
    results[id] = await runner.validate();
  }

  return results;
}

/**
 * Initialize runner plugins
 *
 * Call this on router startup to register all available runners
 * based on environment configuration.
 */
export function initializeRunners(): void {
  console.log('Initializing runner plugins...');

  // Runners will auto-register when imported
  // This function just provides a clear initialization point

  const count = runnerPlugins.size;
  if (count === 0) {
    console.warn('⚠️  No runner plugins registered');
  } else {
    console.log(`✓ ${count} runner plugin(s) initialized`);
  }
}
