/**
 * Bug Fix Configuration Schema
 *
 * Defines the structure of .ai-bugs.json files that live in target repositories.
 * These files customize how Claude investigates and fixes different types of bugs.
 */

/**
 * Infrastructure configuration for a category
 */
export interface InfrastructureConfig {
  /** Command to start infrastructure (e.g., "supabase start") */
  setup: string;
  /** Command to stop infrastructure (e.g., "supabase stop") */
  teardown?: string;
  /** Command to verify infrastructure is ready */
  healthcheck?: string;
  /** Timeout in seconds for setup command (default: 120) */
  timeout?: number;
}

/**
 * Match criteria for categorizing bugs
 */
export interface CategoryMatch {
  /** Labels that trigger this category (any match) */
  labels?: string[];
}

/**
 * Category-specific configuration
 */
export interface CategoryConfig {
  /** How to match bugs to this category */
  match?: CategoryMatch;
  /** Infrastructure to spin up for this category */
  infrastructure?: InfrastructureConfig;
  /** Requirements Claude should follow for this bug type */
  requirements: string[];
  /** Deliverables that must be completed */
  deliverables: string[];
  /** Command to run tests for this category */
  testCommand: string;
}

/**
 * Constraints on what Claude can modify
 */
export interface ConstraintsConfig {
  /** Glob patterns for paths Claude should never touch */
  excludePaths?: string[];
  /** Require tests to pass before committing */
  requireTests?: boolean;
  /** Maximum number of files that can be changed */
  maxFilesChanged?: number;
}

/**
 * Root configuration from .ai-bugs.json
 */
export interface BugFixConfig {
  /** Schema version */
  version: string;
  /** Bug categories with their requirements */
  categories: Record<string, CategoryConfig>;
  /** Global constraints */
  constraints?: ConstraintsConfig;
}

/**
 * Find the matching category for a set of labels
 * Returns the first matching category, or 'default' if no match
 */
export function findMatchingCategory(
  categories: Record<string, CategoryConfig> | undefined,
  labels: string[]
): CategoryConfig | undefined {
  if (!categories) return undefined;

  const normalizedLabels = labels.map((l) => l.toLowerCase());

  // Check each category for a label match
  for (const [name, config] of Object.entries(categories)) {
    if (name === 'default') continue; // Check default last

    const matchLabels = config.match?.labels?.map((l) => l.toLowerCase()) || [];
    if (matchLabels.some((label) => normalizedLabels.includes(label))) {
      return config;
    }
  }

  // Fall back to default category
  return categories.default;
}

/**
 * Validate a bug fix config
 */
export function validateBugConfig(
  config: unknown
): { valid: true; config: BugFixConfig } | { valid: false; error: string } {
  if (!config || typeof config !== 'object') {
    return { valid: false, error: 'Config must be an object' };
  }

  const cfg = config as Record<string, unknown>;

  if (typeof cfg.version !== 'string') {
    return { valid: false, error: 'Config must have a version string' };
  }

  if (!cfg.categories || typeof cfg.categories !== 'object') {
    return { valid: false, error: 'Config must have categories object' };
  }

  // Validate each category
  for (const [name, category] of Object.entries(
    cfg.categories as Record<string, unknown>
  )) {
    if (!category || typeof category !== 'object') {
      return { valid: false, error: `Category '${name}' must be an object` };
    }

    const cat = category as Record<string, unknown>;

    if (!Array.isArray(cat.requirements)) {
      return {
        valid: false,
        error: `Category '${name}' must have requirements array`,
      };
    }

    if (!Array.isArray(cat.deliverables)) {
      return {
        valid: false,
        error: `Category '${name}' must have deliverables array`,
      };
    }

    if (typeof cat.testCommand !== 'string') {
      return {
        valid: false,
        error: `Category '${name}' must have testCommand string`,
      };
    }
  }

  return { valid: true, config: cfg as unknown as BugFixConfig };
}
