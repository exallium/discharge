/**
 * Project configuration for repositories that can be auto-fixed
 */
export interface ProjectConfig {
  id: string;
  repo: string;                  // Git URL (e.g., git@github.com:owner/repo.git)
  repoFullName: string;          // owner/repo format
  branch: string;                // Base branch to create fixes from

  // VCS configuration
  vcs: {
    type: 'github' | 'gitlab' | 'bitbucket' | 'self-hosted';
    owner: string;               // Repository owner/organization/namespace
    repo: string;                // Repository name/project
    reviewers?: string[];        // Auto-request these reviewers on PRs
    labels?: string[];           // Auto-add these labels to PRs
  };

  // Runner configuration
  runner?: {
    type?: string;               // Runner plugin ID (default: 'claude-code')
    timeout?: number;            // Execution timeout in ms (default: 600000)
    env?: Record<string, string>; // Additional environment variables
  };

  triggers: {
    sentry?: {
      projectSlug: string;
      enabled: boolean;
    };
    github?: {
      issues: boolean;
      labels?: string[];         // Only trigger on these labels
    };
    circleci?: {
      projectSlug: string;
      enabled: boolean;
    };
    [key: string]: any;          // Allow custom source configs
  };

  constraints?: {
    maxAttemptsPerDay?: number;
    allowedPaths?: string[];     // Restrict Claude to these directories
    excludedPaths?: string[];    // Never touch these files/dirs
  };
}

/**
 * Registry of all configured projects
 * Add your projects here
 */
export const projects: ProjectConfig[] = [
  // Example:
  // {
  //   id: 'my-app',
  //   repo: 'git@github.com:owner/my-app.git',
  //   repoFullName: 'owner/my-app',
  //   branch: 'main',
  //   vcs: {
  //     type: 'github',
  //     owner: 'owner',
  //     repo: 'my-app',
  //     reviewers: ['alice', 'bob'],
  //     labels: ['automated-fix', 'needs-review']
  //   },
  //   triggers: {
  //     sentry: { projectSlug: 'my-app-prod', enabled: true },
  //     github: { issues: true, labels: ['bug', 'auto-fix'] }
  //   },
  //   constraints: {
  //     maxAttemptsPerDay: 10,
  //     excludedPaths: ['.env', 'config/secrets.yml']
  //   }
  // }
];

/**
 * Find a project by its ID
 */
export function findProjectById(id: string): ProjectConfig | undefined {
  return projects.find(p => p.id === id);
}

/**
 * Find a project by repository full name (owner/repo)
 */
export function findProjectByRepo(repoFullName: string): ProjectConfig | undefined {
  return projects.find(p => p.repoFullName === repoFullName);
}

/**
 * Find projects by source configuration
 */
export function findProjectsBySource(
  sourceType: string,
  matcher: (triggers: any) => boolean
): ProjectConfig[] {
  return projects.filter(p => {
    const trigger = p.triggers[sourceType];
    return trigger && matcher(trigger);
  });
}
