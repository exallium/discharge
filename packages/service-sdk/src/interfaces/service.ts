/**
 * Service Manifest Interface
 *
 * A service bundles related plugins for a single integration.
 * For example, the GitHub service provides both a trigger (for issues/webhooks)
 * and a VCS plugin (for PRs).
 */

import type { TriggerPlugin, SecretRequirement } from './trigger';
import type { VCSPluginFactory } from './vcs';
import type { RunnerPlugin } from './runner';

/**
 * Validation result from service initialization
 */
export interface ServiceValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Service manifest that bundles related plugins
 *
 * Each service (github, sentry, circleci, claude-code) exports a manifest
 * that declares what plugins it provides.
 */
export interface ServiceManifest {
  /** Unique service identifier (e.g., 'github', 'sentry') */
  id: string;

  /** Display name (e.g., 'GitHub', 'Sentry') */
  name: string;

  /** Service version */
  version: string;

  /** Optional trigger plugin */
  trigger?: TriggerPlugin;

  /** Optional VCS plugin factory (for per-repo auth) */
  vcs?: VCSPluginFactory;

  /** Optional runner plugin */
  runner?: RunnerPlugin;

  /**
   * Get all secrets required by this service's plugins
   * Aggregates requirements from trigger, vcs, and runner
   */
  getRequiredSecrets(): SecretRequirement[];

  /**
   * Initialize the service (called once on startup)
   * Can be used for setting up connections, validating config, etc.
   */
  initialize?(): Promise<void>;

  /**
   * Validate service configuration
   * Returns validation result with errors/warnings
   */
  validate?(): Promise<ServiceValidationResult>;
}

/**
 * Service configuration for enabling/disabling services
 */
export interface ServiceConfig {
  /** The service manifest */
  manifest: ServiceManifest;

  /** Whether this service is enabled */
  enabled: boolean;

  /** Optional configuration overrides */
  config?: Record<string, unknown>;
}
