/**
 * VCS Plugin System - Pluggable version control integrations
 *
 * This module bridges between the legacy VCS system and the new service-based architecture.
 * Core types are now defined in @ai-bug-fixer/service-sdk and re-exported here for
 * backward compatibility.
 */

// Re-export all VCS types from the SDK - this is the single source of truth
export type {
  VCSProjectConfig,
  PlanFileResult,
  PullRequest,
  VCSPlugin,
  InvestigationContext,
} from '@ai-bug-fixer/service-sdk';

// Re-export the formatPRBody helper from the SDK
export { formatPRBody } from '@ai-bug-fixer/service-sdk';
