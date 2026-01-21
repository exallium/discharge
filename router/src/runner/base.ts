/**
 * Runner Plugin System - Pluggable AI agent execution
 *
 * Runners execute AI agents (Claude Code, OpenAI, custom LLMs) to investigate
 * and fix bugs. Each runner implements a standard interface for execution.
 *
 * This module bridges between the legacy runner system and the new service-based architecture.
 * All types are now defined in @ai-bug-fixer/service-sdk and re-exported here for
 * backward compatibility.
 */

import { registry } from '@ai-bug-fixer/service-locator';

// Re-export all runner types from the SDK - this is the single source of truth
export type {
  RunnerPlugin,
  RunOptions,
  RunResult,
  ConversationRunOptions,
  TriageResult,
  InvestigationContext,
  AnalysisResult,
} from '@ai-bug-fixer/service-sdk';

// Import types for use in this file
import type { RunnerPlugin } from '@ai-bug-fixer/service-sdk';

/**
 * @deprecated Use the service registry directly
 * Legacy runner registry - now uses the service registry under the hood
 */
const runnerPlugins = new Map<string, RunnerPlugin>();

/**
 * @deprecated Use registry.register() with a ServiceManifest instead
 * Register a runner plugin (legacy interface)
 */
export function registerRunner(runner: RunnerPlugin): void {
  runnerPlugins.set(runner.id, runner);
  console.log(`✓ Registered runner: ${runner.name} (${runner.id})`);
}

/**
 * Get a runner plugin by ID
 * Uses the service registry for lookups
 *
 * @param id - Runner ID (e.g., 'claude-code', 'openai')
 * @returns Runner plugin or undefined
 */
export function getRunner(id: string): RunnerPlugin | undefined {
  // First check the service registry
  const fromRegistry = registry.getRunnerByType(id);
  if (fromRegistry) {
    return fromRegistry;
  }
  // Fall back to legacy registry for backward compatibility
  return runnerPlugins.get(id);
}

/**
 * Get all registered runner plugins
 * Combines runners from the service registry and legacy registry
 *
 * @returns Array of all runners
 */
export function getAllRunners(): RunnerPlugin[] {
  const fromRegistry = registry.getAllRunners();
  const fromLegacy = Array.from(runnerPlugins.values());

  // Combine and dedupe by ID
  const seen = new Set<string>();
  const result: RunnerPlugin[] = [];

  for (const runner of [...fromRegistry, ...fromLegacy]) {
    if (!seen.has(runner.id)) {
      seen.add(runner.id);
      result.push(runner);
    }
  }

  return result;
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

  for (const runner of getAllRunners()) {
    results[runner.id] = await runner.validate();
  }

  return results;
}

/**
 * @deprecated Use initializeServices() from config/services.ts instead
 * Initialize runner plugins
 */
export function initializeRunners(): void {
  console.log('Initializing runner plugins...');

  // Runners are now initialized via the service registry
  // This function is kept for backward compatibility

  const count = getAllRunners().length;
  if (count === 0) {
    console.warn('⚠️  No runner plugins registered');
  } else {
    console.log(`✓ ${count} runner plugin(s) initialized`);
  }
}
