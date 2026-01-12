import { logger } from './logger';

/**
 * Environment variable validation rule
 */
interface EnvRule {
  name: string;
  required: boolean;
  description: string;
  validate?: (value: string) => boolean;
  defaultValue?: string;
}

/**
 * Validation result
 */
interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Environment variable rules
 */
const envRules: EnvRule[] = [
  // System
  {
    name: 'NODE_ENV',
    required: false,
    description: 'Environment mode (development, production, test)',
    defaultValue: 'development',
    validate: (v) => ['development', 'production', 'test'].includes(v),
  },
  {
    name: 'PORT',
    required: false,
    description: 'HTTP server port',
    defaultValue: '3000',
    validate: (v) => !isNaN(parseInt(v)) && parseInt(v) > 0 && parseInt(v) < 65536,
  },
  {
    name: 'REDIS_URL',
    required: true,
    description: 'Redis connection URL',
    validate: (v) => v.startsWith('redis://') || v.startsWith('rediss://'),
  },
  {
    name: 'WORKER_CONCURRENCY',
    required: false,
    description: 'Number of concurrent worker processes',
    defaultValue: '2',
    validate: (v) => !isNaN(parseInt(v)) && parseInt(v) > 0,
  },

  // GitHub (Required for GitHub VCS and Issues trigger)
  {
    name: 'GITHUB_TOKEN',
    required: false, // Only required if using GitHub
    description: 'GitHub personal access token',
    validate: (v) => v.startsWith('ghp_') || v.startsWith('github_pat_'),
  },
  {
    name: 'GITHUB_WEBHOOK_SECRET',
    required: false, // Only required if using GitHub webhooks
    description: 'GitHub webhook secret for signature validation',
    validate: (v) => v.length >= 20,
  },

  // Sentry (Optional)
  {
    name: 'SENTRY_AUTH_TOKEN',
    required: false,
    description: 'Sentry authentication token',
  },
  {
    name: 'SENTRY_ORG',
    required: false,
    description: 'Sentry organization slug',
  },

  // CircleCI (Optional)
  {
    name: 'CIRCLECI_TOKEN',
    required: false,
    description: 'CircleCI personal API token',
  },

  // User (For Docker volume mounting)
  {
    name: 'USER',
    required: false,
    description: 'User for Docker volume mounting',
  },
  {
    name: 'HOST_USER',
    required: false,
    description: 'Host user for Docker volume mounting',
  },

  // Logging
  {
    name: 'LOG_LEVEL',
    required: false,
    description: 'Log level (error, warn, info, debug)',
    defaultValue: 'info',
    validate: (v) => ['error', 'warn', 'info', 'debug'].includes(v.toLowerCase()),
  },
  {
    name: 'LOG_FORMAT',
    required: false,
    description: 'Log format (json, pretty)',
    defaultValue: 'json',
    validate: (v) => ['json', 'pretty'].includes(v.toLowerCase()),
  },

  // Database
  {
    name: 'DATABASE_URL',
    required: true,
    description: 'PostgreSQL connection URL',
    validate: (v) => v.startsWith('postgres://') || v.startsWith('postgresql://'),
  },
  {
    name: 'DB_ENCRYPTION_KEY',
    required: true,
    description: 'AES-256 encryption key for secrets (32 bytes, base64 encoded)',
    validate: (v) => {
      try {
        const decoded = Buffer.from(v, 'base64');
        return decoded.length === 32;
      } catch {
        return false;
      }
    },
  },

  // Admin UI
  {
    name: 'ADMIN_USERNAME',
    required: false,
    description: 'Admin UI username',
    defaultValue: 'admin',
  },
  {
    name: 'ADMIN_PASSWORD',
    required: false, // Will warn if not set
    description: 'Admin UI password (min 12 characters)',
    validate: (v) => v.length >= 12,
  },
];

/**
 * Validate all environment variables
 */
export function validateEnv(): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const rule of envRules) {
    const value = process.env[rule.name];

    // Check if required variable is missing
    if (rule.required && !value) {
      errors.push(`Missing required environment variable: ${rule.name} - ${rule.description}`);
      continue;
    }

    // Set default value if not provided
    if (!value && rule.defaultValue) {
      process.env[rule.name] = rule.defaultValue;
      logger.debug(`Using default value for ${rule.name}`, { value: rule.defaultValue });
      continue;
    }

    // Skip validation if value is not provided and not required
    if (!value) {
      continue;
    }

    // Validate value if validation function provided
    if (rule.validate && !rule.validate(value)) {
      const message = `Invalid value for ${rule.name}: "${value}" - ${rule.description}`;
      if (rule.required) {
        errors.push(message);
      } else {
        warnings.push(message);
      }
    }
  }

  // Additional validation for related variables
  validateRelatedVars(errors, warnings);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate related environment variables
 */
function validateRelatedVars(errors: string[], warnings: string[]): void {
  // If GitHub token is provided, webhook secret should also be provided
  if (process.env.GITHUB_TOKEN && !process.env.GITHUB_WEBHOOK_SECRET) {
    warnings.push(
      'GITHUB_TOKEN is set but GITHUB_WEBHOOK_SECRET is missing - webhook signature validation will be disabled'
    );
  }

  // If Sentry token is provided, org should also be provided
  if (process.env.SENTRY_AUTH_TOKEN && !process.env.SENTRY_ORG) {
    errors.push('SENTRY_AUTH_TOKEN is set but SENTRY_ORG is missing');
  }

  // Warn if USER and HOST_USER are both missing (needed for Docker)
  if (!process.env.USER && !process.env.HOST_USER) {
    warnings.push('Neither USER nor HOST_USER is set - Docker volume mounting may fail');
  }

  // Warn if running in production without proper configuration
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.GITHUB_TOKEN) {
      warnings.push('Running in production without GITHUB_TOKEN - GitHub features will not work');
    }

    if (process.env.LOG_LEVEL === 'debug') {
      warnings.push('Running in production with LOG_LEVEL=debug - this may impact performance');
    }

    if (process.env.REDIS_URL?.includes('localhost')) {
      warnings.push('Running in production with localhost Redis - use a production Redis instance');
    }

    if (process.env.DATABASE_URL?.includes('localhost')) {
      warnings.push('Running in production with localhost PostgreSQL - use a production database');
    }

    if (!process.env.ADMIN_PASSWORD) {
      errors.push('ADMIN_PASSWORD is required in production for admin UI security');
    }
  }
}

/**
 * Validate environment and exit if critical errors found
 */
export function validateEnvOrExit(): void {
  logger.info('Validating environment configuration...');

  const result = validateEnv();

  // Log warnings
  if (result.warnings.length > 0) {
    logger.warn('Environment configuration warnings:', {
      count: result.warnings.length,
      warnings: result.warnings,
    });
  }

  // Log errors and exit if validation failed
  if (!result.valid) {
    logger.error('Environment validation failed', {
      count: result.errors.length,
      errors: result.errors,
    });
    logger.error('Please fix the above errors and restart the server');
    process.exit(1);
  }

  logger.info('Environment validation passed', {
    warnings: result.warnings.length,
  });
}

/**
 * Environment info for debugging
 */
interface EnvInfo {
  nodeVersion: string;
  platform: NodeJS.Platform;
  arch: string;
  nodeEnv: string;
  port: string | number;
  redisConfigured: boolean;
  databaseConfigured: boolean;
  githubConfigured: boolean;
  sentryConfigured: boolean;
  circleCIConfigured: boolean;
  adminConfigured: boolean;
  logLevel: string;
  logFormat: string;
}

/**
 * Get environment info for debugging
 */
export function getEnvInfo(): EnvInfo {
  return {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    nodeEnv: process.env.NODE_ENV || 'development',
    port: process.env.PORT || 3000,
    redisConfigured: !!process.env.REDIS_URL,
    databaseConfigured: !!process.env.DATABASE_URL,
    githubConfigured: !!process.env.GITHUB_TOKEN,
    sentryConfigured: !!process.env.SENTRY_AUTH_TOKEN,
    circleCIConfigured: !!process.env.CIRCLECI_TOKEN,
    adminConfigured: !!process.env.ADMIN_PASSWORD,
    logLevel: process.env.LOG_LEVEL || 'info',
    logFormat: process.env.LOG_FORMAT || 'json',
  };
}
