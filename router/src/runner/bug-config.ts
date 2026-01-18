/**
 * Bug Fix Configuration Schema
 *
 * Defines the structure of .ai-bugs.json files that live in target repositories.
 * This schema uses a rules + agents system that supports:
 * - Global rules (file paths or inline strings)
 * - Named agents with model selection (small/medium/large)
 * - System-defined agent hooks that users can extend
 * - AI-determined agent selection with escalation capabilities
 */

import { readFile } from 'fs/promises';
import { join } from 'path';

// ============================================================================
// Types
// ============================================================================

/**
 * Model tier for agents
 * - small: Fast, low-cost model for simple tasks (triage)
 * - medium: Balanced model for most tasks (investigation, simple fixes)
 * - large: Most capable model for complex tasks (complex fixes)
 */
export type ModelTier = 'small' | 'medium' | 'large';

/**
 * Rule definition - either an inline string or a file path reference
 */
export type RuleDefinition = string | { rulePath: string };

/**
 * Agent configuration
 */
export interface AgentConfig {
  /** Path to agent-specific markdown file (relative to repo root) */
  agentPath?: string;

  /** Model tier: defaults to system-defined default for that agent */
  model?: ModelTier;

  /** Agent-specific rules (in addition to global rules) */
  rules?: RuleDefinition[];

  /** Human-readable description for admin UI */
  description?: string;
}

/**
 * Additional configuration options
 */
export interface AiBugsConfigOptions {
  /** Secondary repos for cross-referencing */
  secondaryRepos?: string[];
}

/**
 * Root configuration from .ai-bugs.json
 */
export interface AiBugsConfig {
  /** Schema version, e.g., "2" */
  version: string;

  /** Global rules applied to all agents */
  rules?: RuleDefinition[];

  /** Named agents with their configuration */
  agents?: Record<string, AgentConfig>;

  /** Additional configuration options */
  config?: AiBugsConfigOptions;
}

/**
 * Resolved rule (after loading file contents)
 */
export interface ResolvedRule {
  content: string;
  source: string; // file path or "inline"
}

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

  /** Labels to add to the issue */
  labels?: string[];
}

/**
 * Escalation request (returned by agents)
 */
export interface EscalationRequest {
  /** Target agent name (e.g., "complex") or model tier (e.g., "large") */
  targetAgent?: string;

  /** Reason for escalation */
  reason: string;
}

/**
 * Investigation result stored for handoff to fix agents
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
}

// ============================================================================
// System-Defined Agents
// ============================================================================

/**
 * System-defined agent defaults
 * Users can extend these but not replace the core behavior
 */
export interface SystemAgentDefaults {
  model: ModelTier;
  description: string;
  systemRules?: string[];
}

/**
 * Get system-defined agent defaults
 */
export function getSystemAgentDefaults(): Record<string, SystemAgentDefaults> {
  return {
    triage: {
      model: 'small',
      description: 'Quick categorization - determines complexity and routes to appropriate agent',
      systemRules: [
        'Analyze the issue to determine if it is actionable.',
        'For actionable issues, assess complexity (simple vs complex) and whether it is trivial (obvious one-line fix).',
        'Return structured JSON with your assessment.',
      ],
    },
    investigate: {
      model: 'medium',
      description: 'Deep analysis - reads code, identifies root cause, but does not implement fixes',
      systemRules: [
        'Thoroughly investigate the issue by reading relevant code files.',
        'Identify the root cause and affected files.',
        'Document your findings but do not make any code changes.',
      ],
    },
    simple: {
      model: 'medium',
      description: 'Simple fixes - straightforward bugs, typos, small features',
      systemRules: [
        'Implement the fix with minimal, focused changes.',
        'Run tests to verify the fix.',
        'Commit changes with a clear message.',
      ],
    },
    complex: {
      model: 'large',
      description: 'Complex fixes - architectural changes, multi-file refactors, subtle bugs',
      systemRules: [
        'Carefully plan the implementation approach.',
        'Make changes systematically across affected files.',
        'Ensure comprehensive test coverage.',
        'Document any architectural decisions.',
      ],
    },
  };
}

/**
 * Get the effective agent configuration by merging user config with system defaults
 *
 * When user defines an agent with the same name as a system agent:
 * - User's `rules` are **appended** to system rules
 * - User's `model` **overrides** system default (if provided)
 * - User's `agentPath` content is **appended** to system prompts
 * - User's `description` **overrides** system description (if provided)
 */
export function mergeWithSystemAgent(
  agentName: string,
  userConfig: AgentConfig | undefined,
  systemDefaults: Record<string, SystemAgentDefaults>
): { config: AgentConfig; isSystemAgent: boolean } {
  const systemAgent = systemDefaults[agentName];

  if (!systemAgent) {
    // Not a system agent, return user config as-is
    return {
      config: userConfig || {},
      isSystemAgent: false,
    };
  }

  // Merge user config with system defaults
  const mergedConfig: AgentConfig = {
    model: userConfig?.model || systemAgent.model,
    description: userConfig?.description || systemAgent.description,
    agentPath: userConfig?.agentPath,
    rules: [
      // System rules first (as inline strings)
      ...(systemAgent.systemRules || []),
      // Then user rules
      ...(userConfig?.rules || []),
    ],
  };

  return {
    config: mergedConfig,
    isSystemAgent: true,
  };
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate a rule definition
 */
function validateRule(rule: unknown, index: number): string | null {
  if (typeof rule === 'string') {
    if (rule.trim().length === 0) {
      return `Rule at index ${index} is an empty string`;
    }
    return null;
  }

  if (typeof rule === 'object' && rule !== null) {
    const ruleObj = rule as Record<string, unknown>;
    if (typeof ruleObj.rulePath !== 'string') {
      return `Rule at index ${index} must have a string 'rulePath' property`;
    }
    if (ruleObj.rulePath.trim().length === 0) {
      return `Rule at index ${index} has an empty 'rulePath'`;
    }
    return null;
  }

  return `Rule at index ${index} must be a string or object with 'rulePath'`;
}

/**
 * Validate an agent configuration
 */
function validateAgent(name: string, agent: unknown): string | null {
  if (!agent || typeof agent !== 'object') {
    return `Agent '${name}' must be an object`;
  }

  const agentObj = agent as Record<string, unknown>;

  // Validate model if provided
  if (agentObj.model !== undefined) {
    if (!['small', 'medium', 'large'].includes(agentObj.model as string)) {
      return `Agent '${name}' has invalid model: ${agentObj.model}. Must be 'small', 'medium', or 'large'`;
    }
  }

  // Validate agentPath if provided
  if (agentObj.agentPath !== undefined && typeof agentObj.agentPath !== 'string') {
    return `Agent '${name}' has invalid agentPath: must be a string`;
  }

  // Validate description if provided
  if (agentObj.description !== undefined && typeof agentObj.description !== 'string') {
    return `Agent '${name}' has invalid description: must be a string`;
  }

  // Validate rules if provided
  if (agentObj.rules !== undefined) {
    if (!Array.isArray(agentObj.rules)) {
      return `Agent '${name}' has invalid rules: must be an array`;
    }
    for (let i = 0; i < agentObj.rules.length; i++) {
      const ruleError = validateRule(agentObj.rules[i], i);
      if (ruleError) {
        return `Agent '${name}': ${ruleError}`;
      }
    }
  }

  return null;
}

/**
 * Validate a bug fix config
 */
export function validateBugConfig(
  config: unknown
): { valid: true; config: AiBugsConfig } | { valid: false; error: string } {
  if (!config || typeof config !== 'object') {
    return { valid: false, error: 'Config must be an object' };
  }

  const cfg = config as Record<string, unknown>;

  // Validate version
  if (typeof cfg.version !== 'string') {
    return { valid: false, error: 'Config must have a version string' };
  }

  // Validate global rules if present
  if (cfg.rules !== undefined) {
    if (!Array.isArray(cfg.rules)) {
      return { valid: false, error: 'Rules must be an array' };
    }
    for (let i = 0; i < cfg.rules.length; i++) {
      const ruleError = validateRule(cfg.rules[i], i);
      if (ruleError) {
        return { valid: false, error: ruleError };
      }
    }
  }

  // Validate agents if present
  if (cfg.agents !== undefined) {
    if (typeof cfg.agents !== 'object' || cfg.agents === null) {
      return { valid: false, error: 'Agents must be an object' };
    }
    for (const [name, agent] of Object.entries(cfg.agents)) {
      const agentError = validateAgent(name, agent);
      if (agentError) {
        return { valid: false, error: agentError };
      }
    }
  }

  // Validate config options if present
  if (cfg.config !== undefined) {
    if (typeof cfg.config !== 'object' || cfg.config === null) {
      return { valid: false, error: 'Config options must be an object' };
    }

    const configOptions = cfg.config as Record<string, unknown>;

    // Validate secondaryRepos if present
    if (configOptions.secondaryRepos !== undefined) {
      if (!Array.isArray(configOptions.secondaryRepos)) {
        return { valid: false, error: 'secondaryRepos must be an array' };
      }
      for (const repo of configOptions.secondaryRepos) {
        if (typeof repo !== 'string' || !repo.includes('/')) {
          return { valid: false, error: `Invalid repo format: ${repo}. Use 'owner/repo'` };
        }
      }
    }
  }

  return { valid: true, config: cfg as unknown as AiBugsConfig };
}

// ============================================================================
// Rule Resolution
// ============================================================================

/**
 * Resolve rules by loading file contents
 *
 * @param rules - Array of rule definitions
 * @param workspacePath - Path to the workspace/repo root
 * @returns Array of resolved rules with content and source
 */
export async function resolveRules(
  rules: RuleDefinition[] | undefined,
  workspacePath: string
): Promise<ResolvedRule[]> {
  if (!rules || rules.length === 0) {
    return [];
  }

  const resolved: ResolvedRule[] = [];

  for (const rule of rules) {
    if (typeof rule === 'string') {
      // Inline rule
      resolved.push({
        content: rule,
        source: 'inline',
      });
    } else {
      // File path rule
      try {
        const filePath = join(workspacePath, rule.rulePath);
        const content = await readFile(filePath, 'utf-8');
        resolved.push({
          content: content.trim(),
          source: rule.rulePath,
        });
      } catch (error) {
        // Log warning but continue - missing rule files shouldn't break the system
        console.warn(`[bug-config] Failed to load rule file: ${rule.rulePath}`, error);
        resolved.push({
          content: `[Rule file not found: ${rule.rulePath}]`,
          source: rule.rulePath,
        });
      }
    }
  }

  return resolved;
}

/**
 * Get all resolved rules for an agent (global + agent-specific)
 *
 * @param config - The AiBugsConfig
 * @param agentName - Name of the agent
 * @param workspacePath - Path to the workspace/repo root
 * @returns Array of resolved rules
 */
export async function getAgentRules(
  config: AiBugsConfig | undefined,
  agentName: string,
  workspacePath: string
): Promise<ResolvedRule[]> {
  const globalRules = await resolveRules(config?.rules, workspacePath);

  const systemDefaults = getSystemAgentDefaults();
  const { config: agentConfig } = mergeWithSystemAgent(
    agentName,
    config?.agents?.[agentName],
    systemDefaults
  );

  const agentRules = await resolveRules(agentConfig.rules, workspacePath);

  // Load agent path content if specified
  let agentPathContent: ResolvedRule | undefined;
  if (agentConfig.agentPath) {
    try {
      const filePath = join(workspacePath, agentConfig.agentPath);
      const content = await readFile(filePath, 'utf-8');
      agentPathContent = {
        content: content.trim(),
        source: agentConfig.agentPath,
      };
    } catch (error) {
      console.warn(`[bug-config] Failed to load agent file: ${agentConfig.agentPath}`, error);
    }
  }

  return [
    ...globalRules,
    ...agentRules,
    ...(agentPathContent ? [agentPathContent] : []),
  ];
}

// ============================================================================
// Agent Selection Helpers
// ============================================================================

/**
 * Get the effective model for an agent
 */
export function getAgentModel(
  config: AiBugsConfig | undefined,
  agentName: string
): ModelTier {
  const systemDefaults = getSystemAgentDefaults();
  const { config: agentConfig } = mergeWithSystemAgent(
    agentName,
    config?.agents?.[agentName],
    systemDefaults
  );

  return agentConfig.model || 'medium'; // Default to medium
}

/**
 * Get the description for an agent (for admin UI and triage)
 */
export function getAgentDescription(
  config: AiBugsConfig | undefined,
  agentName: string
): string {
  const systemDefaults = getSystemAgentDefaults();
  const systemAgent = systemDefaults[agentName];

  // User-defined agent
  const userAgent = config?.agents?.[agentName];
  if (userAgent?.description) {
    return userAgent.description;
  }

  // System agent
  if (systemAgent) {
    return systemAgent.description;
  }

  return `Agent: ${agentName}`;
}

/**
 * Get list of available agents (system + user-defined)
 */
export function getAvailableAgents(
  config: AiBugsConfig | undefined
): Array<{ name: string; description: string; model: ModelTier; isSystem: boolean }> {
  const systemDefaults = getSystemAgentDefaults();
  const agents: Array<{ name: string; description: string; model: ModelTier; isSystem: boolean }> = [];

  // Add system agents
  for (const [name, defaults] of Object.entries(systemDefaults)) {
    const userConfig = config?.agents?.[name];
    agents.push({
      name,
      description: userConfig?.description || defaults.description,
      model: userConfig?.model || defaults.model,
      isSystem: true,
    });
  }

  // Add user-defined agents (not overriding system agents)
  if (config?.agents) {
    for (const [name, agentConfig] of Object.entries(config.agents)) {
      if (!systemDefaults[name]) {
        agents.push({
          name,
          description: agentConfig.description || `Custom agent: ${name}`,
          model: agentConfig.model || 'medium',
          isSystem: false,
        });
      }
    }
  }

  return agents;
}

/**
 * Determine if an agent name refers to a system agent
 */
export function isSystemAgent(agentName: string): boolean {
  const systemDefaults = getSystemAgentDefaults();
  return agentName in systemDefaults;
}
