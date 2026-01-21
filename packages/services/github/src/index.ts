/**
 * GitHub Service Plugin
 *
 * Provides GitHub Issues trigger and GitHub VCS plugin for AI Bug Fixer.
 * Uses GitHub App authentication via SDK's GitHubAuthProvider.
 */

import { Octokit } from '@octokit/rest';
import type {
  ServiceManifest,
  SecretRequirement,
  VCSPluginFactory,
  VCSPlugin,
  GitHubAuthProvider,
} from '@ai-bug-fixer/service-sdk';
import { getGitHubAuthProvider, getLogger } from '@ai-bug-fixer/service-sdk';
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
      const githubAuth = getGitHubAuthProvider();

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
      const githubAuth = getGitHubAuthProvider();
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

      // Check if GitHub auth provider is configured
      const githubAuth = getGitHubAuthProvider();
      if (!githubAuth) {
        warnings.push('GitHub auth provider not configured - GitHub App features will be limited');
      } else {
        // Verify app credentials are available
        const credentials = await githubAuth.getAppCredentials();
        if (!credentials) {
          warnings.push('GitHub App credentials not configured - using token-based auth only');
        }
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
