/**
 * Runner module - Pluggable AI agent execution and fix orchestration
 */

// Re-export orchestrator
export { orchestrateFix } from './orchestrator';

// Re-export runner plugin system
export {
  RunnerPlugin,
  RunOptions,
  RunResult,
  AnalysisResult,
  getRunner,
  getAllRunners,
  validateAllRunners,
  registerRunner,
  initializeRunners,
} from './base';

// Re-export runners
export { initializeRunners as initRunners } from './runners';

// Re-export legacy Claude runner (for backwards compatibility)
export {
  runClaudeInContainer,
  isDockerAvailable,
  isClaudeRunnerImageAvailable,
  RunClaudeOptions,
  RunClaudeResult,
} from './claude';

// Re-export prompts
export { buildInvestigationPrompt, buildSimplePrompt } from './prompts';

// Re-export tools
export {
  generateAndMountTools,
  generateToolsReadme,
  validateTool,
  validateTools,
} from './tools';
