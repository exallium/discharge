/**
 * Runner Plugin Registry
 *
 * Auto-registers runner plugins based on available environment configuration.
 * Plugins are initialized on router startup.
 */

import { registerRunner, initializeRunners as initRunners } from '../base';
import { ClaudeCodeRunner } from './claude-code';

/**
 * Initialize and register all runner plugins
 *
 * This should be called once on router startup.
 */
export function initializeRunners(): void {
  console.log('Initializing runner plugins...');

  // Always register ClaudeCode runner (official runner)
  const claudeCode = new ClaudeCodeRunner();
  registerRunner(claudeCode);

  // Future runners can be conditionally registered based on env vars:
  //
  // if (process.env.OPENAI_API_KEY) {
  //   const openai = new OpenAIRunner(process.env.OPENAI_API_KEY);
  //   registerRunner(openai);
  // }
  //
  // if (process.env.CUSTOM_RUNNER_ENABLED) {
  //   const custom = new CustomRunner();
  //   registerRunner(custom);
  // }

  // Call base initialization (logs summary)
  initRunners();
}

// Re-export for convenience
export { getRunner, getAllRunners, validateAllRunners } from '../base';
