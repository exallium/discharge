/**
 * GitHub Service Plugin
 *
 * Provides GitHub Issues trigger and GitHub VCS plugin for AI Bug Fixer.
 * Uses GitHub App authentication via SDK's VCSAuthProvider.
 */

import { Octokit } from '@octokit/rest';
import type {
  ServiceManifest,
  SecretRequirement,
  VCSPluginFactory,
  VCSPlugin,
  VCSAuthProvider,
} from '@ai-bug-fixer/service-sdk';
import { getVCSAuthProvider, getLogger } from '@ai-bug-fixer/service-sdk';
import { GitHubIssuesTrigger } from './trigger';
import { GitHubVCS } from './vcs';

// Export classes for direct use
export { GitHubIssuesTrigger } from './trigger';
export { GitHubVCS } from './vcs';

// Export webhook types for consumers
export * from './types/webhooks';

/**
 * Create a VCS plugin factory for GitHub
 * The factory creates GitHubVCS instances for specific repositories using GitHub App auth
 */
function createGitHubVCSFactory(): VCSPluginFactory {
  return {
    async getForRepo(repoFullName: string): Promise<VCSPlugin | null> {
      const logger = getLogger();
      const githubAuth = getVCSAuthProvider();

      if (!githubAuth) {
        logger.warn('[GitHubVCSFactory] GitHub auth provider not configured');
        return null;
      }

      const token = await githubAuth.getToken(repoFullName);
      if (!token) {
        logger.warn(`[GitHubVCSFactory] No GitHub App installation for repo: ${repoFullName}`);
        return null;
      }

      const octokit = new Octokit({ auth: token });
      return new GitHubVCS(octokit);
    },

    async isAvailable(repoFullName: string): Promise<boolean> {
      const githubAuth = getVCSAuthProvider();
      if (!githubAuth) {
        return false;
      }

      const token = await githubAuth.getToken(repoFullName);
      return token !== null;
    },

    getRequiredSecrets(): SecretRequirement[] {
      // GitHub uses App authentication - no secrets needed from users
      return [];
    },
  };
}

/**
 * Create a GitHub service manifest
 *
 * The trigger is instantiated directly since it uses SDK providers.
 * The VCS uses a factory pattern to create instances per-repo with GitHub App auth.
 */
export function createGitHubService(): ServiceManifest {
  const trigger = new GitHubIssuesTrigger();
  const vcsFactory = createGitHubVCSFactory();

  return {
    id: 'github',
    name: 'GitHub',
    version: '1.0.0',

    trigger,
    vcs: vcsFactory,

    getRequiredSecrets(): SecretRequirement[] {
      // Combine secrets from trigger and VCS
      return [
        ...trigger.getRequiredSecrets(),
        ...vcsFactory.getRequiredSecrets(),
      ];
    },

    async initialize(): Promise<void> {
      console.log('[GitHubService] Initialized');
    },

    async validate() {
      const errors: string[] = [];
      const warnings: string[] = [];

      // Check if VCS auth provider is configured
      const vcsAuth = getVCSAuthProvider();
      if (!vcsAuth) {
        warnings.push('VCS auth provider not configured - GitHub App features will be limited');
      } else {
        // Try to get a token for a test repo to verify auth is working
        // This is a lightweight check - we just verify the provider exists
        warnings.push('GitHub App auth configured via VCS auth provider');
      }

      return {
        valid: errors.length === 0,
        errors,
        warnings,
      };
    },
  };
}

// Default export is the factory function
export default createGitHubService;
