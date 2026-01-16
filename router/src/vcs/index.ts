import { VCSPlugin } from './base';
import { GitHubVCS } from './github';
import { getSecret } from '../secrets';
import { registerPRProvider, getGitHubPRProvider } from '../pr';

/**
 * Registry of VCS plugins
 */
const vcsPlugins = new Map<string, VCSPlugin>();

/**
 * Get GitHub token for a project (or global default)
 */
export async function getGitHubToken(projectId?: string): Promise<string | null> {
  return getSecret('github', 'token', projectId);
}

/**
 * Get GitHub webhook secret for a project (or global default)
 */
export async function getGitHubWebhookSecret(projectId?: string): Promise<string | null> {
  return getSecret('github', 'webhook_secret', projectId);
}

/**
 * Get or create a GitHub VCS instance for a project
 * Uses project-specific token if available, otherwise global
 */
export async function getGitHubVCS(projectId?: string): Promise<GitHubVCS | null> {
  const token = await getGitHubToken(projectId);
  if (!token) {
    return null;
  }
  return new GitHubVCS(token);
}

/**
 * Initialize global VCS plugins (for backwards compatibility)
 */
export async function initializeVCS(): Promise<void> {
  // GitHub VCS (global instance)
  const githubToken = await getGitHubToken();
  if (githubToken) {
    const github = new GitHubVCS(githubToken);
    vcsPlugins.set('github', github);
    console.log('✓ GitHub VCS initialized');
  }

  // Register GitHub PR provider (always available, checks token at runtime)
  registerPRProvider(getGitHubPRProvider());
  console.log('✓ GitHub PR provider registered');

  // Future: GitLab, Bitbucket, etc.
}

/**
 * Get a VCS plugin by ID (global instance)
 * @deprecated Use getVCSForProject for project-specific tokens
 */
export function getVCSPlugin(id: string): VCSPlugin | undefined {
  return vcsPlugins.get(id);
}

/**
 * Get a VCS plugin for a specific project
 * Creates a new instance with project-specific credentials
 */
export async function getVCSForProject(
  vcsType: 'github' | 'gitlab' | 'bitbucket' | 'self-hosted',
  projectId?: string
): Promise<VCSPlugin | null> {
  switch (vcsType) {
    case 'github':
      return getGitHubVCS(projectId);
    // Future: case 'gitlab': return getGitLabVCS(projectId);
    default:
      return null;
  }
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
