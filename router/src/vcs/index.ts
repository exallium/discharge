import { VCSPlugin } from './base';
import { GitHubVCS } from './github';

/**
 * Registry of VCS plugins
 */
const vcsPlugins = new Map<string, VCSPlugin>();

/**
 * Initialize VCS plugins with credentials from environment
 */
export function initializeVCS(): void {
  // GitHub VCS
  const githubToken = process.env.GITHUB_TOKEN;
  if (githubToken) {
    const github = new GitHubVCS(githubToken);
    vcsPlugins.set('github', github);
    console.log('✓ GitHub VCS initialized');
  }

  // Future: GitLab, Bitbucket, etc.
  // const gitlabToken = process.env.GITLAB_TOKEN;
  // if (gitlabToken) {
  //   const gitlab = new GitLabVCS(gitlabToken);
  //   vcsPlugins.set('gitlab', gitlab);
  // }
}

/**
 * Get a VCS plugin by ID
 */
export function getVCSPlugin(id: string): VCSPlugin | undefined {
  return vcsPlugins.get(id);
}

/**
 * List all available VCS plugins
 */
export function listVCSPlugins(): string[] {
  return Array.from(vcsPlugins.keys());
}

/**
 * Get all VCS plugins
 */
export function getAllVCSPlugins(): VCSPlugin[] {
  return Array.from(vcsPlugins.values());
}

/**
 * Check if a VCS plugin is available
 */
export function hasVCSPlugin(id: string): boolean {
  return vcsPlugins.has(id);
}

/**
 * Validate all VCS plugins
 */
export async function validateAllVCS(): Promise<Record<string, { valid: boolean; error?: string }>> {
  const results: Record<string, { valid: boolean; error?: string }> = {};

  for (const [id, plugin] of vcsPlugins.entries()) {
    results[id] = await plugin.validate();
  }

  return results;
}
