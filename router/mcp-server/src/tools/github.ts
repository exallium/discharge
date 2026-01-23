/**
 * GitHub read-only MCP tools
 *
 * Provides tools to fetch GitHub issues, pull requests, and related data.
 * All operations are read-only.
 */

import { z } from 'zod';
import { getSecret } from '../secrets.js';
import { getProject } from '../db.js';
import { getCurrentProjectId } from '../index.js';
import type { McpTool } from '../types.js';

// Input schemas for tools
export const GetIssueSchema = z.object({
  owner: z.string().describe('Repository owner (user or organization)'),
  repo: z.string().describe('Repository name'),
  issueNumber: z.number().describe('Issue number'),
  projectId: z.string().optional().describe('Optional: Discharge project ID'),
});

export const GetIssueCommentsSchema = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  issueNumber: z.number().describe('Issue number'),
  projectId: z.string().optional().describe('Optional: Discharge project ID'),
});

export const GetIssueEventsSchema = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  issueNumber: z.number().describe('Issue number'),
  projectId: z.string().optional().describe('Optional: Discharge project ID'),
});

export const SearchIssuesSchema = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  query: z.string().optional().describe('Search query'),
  state: z.enum(['open', 'closed', 'all']).optional().default('open').describe('Issue state filter'),
  labels: z.string().optional().describe('Comma-separated list of labels'),
  limit: z.number().optional().default(30).describe('Maximum issues to return'),
  projectId: z.string().optional().describe('Optional: Discharge project ID'),
});

export const GetRepoIssuesSchema = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  state: z.enum(['open', 'closed', 'all']).optional().default('open').describe('Issue state filter'),
  limit: z.number().optional().default(30).describe('Maximum issues to return'),
  projectId: z.string().optional().describe('Optional: Discharge project ID'),
});

export const GetPullRequestSchema = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  pullNumber: z.number().describe('Pull request number'),
  projectId: z.string().optional().describe('Optional: Discharge project ID'),
});

export const GetPullRequestDiffSchema = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  pullNumber: z.number().describe('Pull request number'),
  projectId: z.string().optional().describe('Optional: Discharge project ID'),
});

export const GetPullRequestReviewsSchema = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  pullNumber: z.number().describe('Pull request number'),
  projectId: z.string().optional().describe('Optional: Discharge project ID'),
});

/**
 * Resolve project ID from params or session
 */
function resolveProjectId(providedProjectId?: string): string | null {
  return providedProjectId || getCurrentProjectId();
}

/**
 * Get GitHub token for a project
 */
async function getGitHubToken(providedProjectId?: string): Promise<string | null> {
  const projectId = resolveProjectId(providedProjectId);
  if (!projectId) {
    console.error('[MCP/GitHub] No project ID available');
    return null;
  }

  const project = await getProject(projectId);
  if (!project) {
    console.error(`[MCP/GitHub] Project not found: ${projectId}`);
    return null;
  }

  const token = await getSecret('github', 'token', projectId);
  if (!token) {
    console.error(`[MCP/GitHub] GitHub token not found for project: ${projectId}`);
    return null;
  }

  return token;
}

/**
 * Make a GitHub API request
 */
async function githubFetch<T>(
  token: string,
  path: string,
  accept?: string
): Promise<T> {
  const url = `https://api.github.com${path}`;
  console.error(`[MCP/GitHub] Fetching: ${url}`);

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: accept || 'application/vnd.github.v3+json',
      'User-Agent': 'discharge-mcp',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API error: ${response.status} ${response.statusText} - ${text}`);
  }

  // For diff requests, return raw text
  if (accept === 'application/vnd.github.v3.diff') {
    return (await response.text()) as unknown as T;
  }

  return response.json() as Promise<T>;
}

// Tool implementations

/**
 * Get GitHub issue details
 */
export async function getIssue(params: z.infer<typeof GetIssueSchema>): Promise<string> {
  const token = await getGitHubToken(params.projectId);
  if (!token) {
    return JSON.stringify({ error: 'GitHub token not configured for this project' });
  }

  try {
    const issue = await githubFetch(
      token,
      `/repos/${params.owner}/${params.repo}/issues/${params.issueNumber}`
    );
    return JSON.stringify(issue, null, 2);
  } catch (error) {
    return JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Get issue comments
 */
export async function getIssueComments(
  params: z.infer<typeof GetIssueCommentsSchema>
): Promise<string> {
  const token = await getGitHubToken(params.projectId);
  if (!token) {
    return JSON.stringify({ error: 'GitHub token not configured for this project' });
  }

  try {
    const comments = await githubFetch<unknown[]>(
      token,
      `/repos/${params.owner}/${params.repo}/issues/${params.issueNumber}/comments`
    );

    // Simplify for readability
    const simplified = comments.map((comment: unknown) => {
      const c = comment as Record<string, unknown>;
      const user = c.user as Record<string, unknown> | null;
      return {
        id: c.id,
        user: user?.login,
        body: c.body,
        createdAt: c.created_at,
        updatedAt: c.updated_at,
      };
    });

    return JSON.stringify(simplified, null, 2);
  } catch (error) {
    return JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Get issue timeline events
 */
export async function getIssueEvents(
  params: z.infer<typeof GetIssueEventsSchema>
): Promise<string> {
  const token = await getGitHubToken(params.projectId);
  if (!token) {
    return JSON.stringify({ error: 'GitHub token not configured for this project' });
  }

  try {
    const events = await githubFetch<unknown[]>(
      token,
      `/repos/${params.owner}/${params.repo}/issues/${params.issueNumber}/timeline`,
      'application/vnd.github.v3+json'
    );

    // Simplify for readability
    const simplified = events.map((event: unknown) => {
      const e = event as Record<string, unknown>;
      const actor = e.actor as Record<string, unknown> | null;
      return {
        event: e.event,
        actor: actor?.login,
        createdAt: e.created_at,
        label: e.label,
        body: e.body,
        commitId: e.commit_id,
      };
    });

    return JSON.stringify(simplified, null, 2);
  } catch (error) {
    return JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Search repository issues
 */
export async function searchIssues(
  params: z.infer<typeof SearchIssuesSchema>
): Promise<string> {
  const token = await getGitHubToken(params.projectId);
  if (!token) {
    return JSON.stringify({ error: 'GitHub token not configured for this project' });
  }

  try {
    // Build search query
    let q = `repo:${params.owner}/${params.repo} is:issue`;

    if (params.state && params.state !== 'all') {
      q += ` is:${params.state}`;
    }

    if (params.labels) {
      const labelList = params.labels.split(',').map((l) => l.trim());
      labelList.forEach((label) => {
        q += ` label:"${label}"`;
      });
    }

    if (params.query) {
      q += ` ${params.query}`;
    }

    const queryParams = new URLSearchParams({
      q,
      per_page: String(params.limit),
    });

    const result = await githubFetch<{ items: unknown[] }>(
      token,
      `/search/issues?${queryParams}`
    );

    // Simplify for readability
    const simplified = result.items.map((issue: unknown) => {
      const i = issue as Record<string, unknown>;
      const user = i.user as Record<string, unknown> | null;
      const labels = i.labels as Record<string, unknown>[] | null;
      return {
        number: i.number,
        title: i.title,
        state: i.state,
        user: user?.login,
        labels: labels?.map((l) => l.name),
        createdAt: i.created_at,
        updatedAt: i.updated_at,
        comments: i.comments,
        htmlUrl: i.html_url,
      };
    });

    return JSON.stringify(simplified, null, 2);
  } catch (error) {
    return JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Get repository issues list
 */
export async function getRepoIssues(
  params: z.infer<typeof GetRepoIssuesSchema>
): Promise<string> {
  const token = await getGitHubToken(params.projectId);
  if (!token) {
    return JSON.stringify({ error: 'GitHub token not configured for this project' });
  }

  try {
    const queryParams = new URLSearchParams({
      state: params.state || 'open',
      per_page: String(params.limit),
    });

    const issues = await githubFetch<unknown[]>(
      token,
      `/repos/${params.owner}/${params.repo}/issues?${queryParams}`
    );

    // Simplify for readability (filter out PRs which are also returned by issues endpoint)
    const simplified = issues
      .filter((issue: unknown) => {
        const i = issue as Record<string, unknown>;
        return !i.pull_request; // Exclude PRs
      })
      .map((issue: unknown) => {
        const i = issue as Record<string, unknown>;
        const user = i.user as Record<string, unknown> | null;
        const labels = i.labels as Record<string, unknown>[] | null;
        return {
          number: i.number,
          title: i.title,
          state: i.state,
          user: user?.login,
          labels: labels?.map((l) => l.name),
          createdAt: i.created_at,
          updatedAt: i.updated_at,
          comments: i.comments,
          htmlUrl: i.html_url,
        };
      });

    return JSON.stringify(simplified, null, 2);
  } catch (error) {
    return JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Get pull request details
 */
export async function getPullRequest(
  params: z.infer<typeof GetPullRequestSchema>
): Promise<string> {
  const token = await getGitHubToken(params.projectId);
  if (!token) {
    return JSON.stringify({ error: 'GitHub token not configured for this project' });
  }

  try {
    const pr = await githubFetch(
      token,
      `/repos/${params.owner}/${params.repo}/pulls/${params.pullNumber}`
    );
    return JSON.stringify(pr, null, 2);
  } catch (error) {
    return JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Get pull request diff
 */
export async function getPullRequestDiff(
  params: z.infer<typeof GetPullRequestDiffSchema>
): Promise<string> {
  const token = await getGitHubToken(params.projectId);
  if (!token) {
    return JSON.stringify({ error: 'GitHub token not configured for this project' });
  }

  try {
    const diff = await githubFetch<string>(
      token,
      `/repos/${params.owner}/${params.repo}/pulls/${params.pullNumber}`,
      'application/vnd.github.v3.diff'
    );
    return diff;
  } catch (error) {
    return JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Get pull request reviews
 */
export async function getPullRequestReviews(
  params: z.infer<typeof GetPullRequestReviewsSchema>
): Promise<string> {
  const token = await getGitHubToken(params.projectId);
  if (!token) {
    return JSON.stringify({ error: 'GitHub token not configured for this project' });
  }

  try {
    const reviews = await githubFetch<unknown[]>(
      token,
      `/repos/${params.owner}/${params.repo}/pulls/${params.pullNumber}/reviews`
    );

    // Simplify for readability
    const simplified = reviews.map((review: unknown) => {
      const r = review as Record<string, unknown>;
      const user = r.user as Record<string, unknown> | null;
      return {
        id: r.id,
        user: user?.login,
        state: r.state,
        body: r.body,
        submittedAt: r.submitted_at,
      };
    });

    return JSON.stringify(simplified, null, 2);
  } catch (error) {
    return JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * GitHub tool definitions for MCP server
 *
 * All tools are read-only and prefixed with 'github_'.
 */
export const githubTools: McpTool[] = [
  {
    name: 'github_get_issue',
    description:
      'Get full details for a GitHub issue including title, body, labels, and metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner (user or organization)' },
        repo: { type: 'string', description: 'Repository name' },
        issueNumber: { type: 'number', description: 'Issue number' },
        projectId: { type: 'string', description: 'Optional: Discharge project ID' },
      },
      required: ['owner', 'repo', 'issueNumber'],
    },
    handler: (args) =>
      getIssue({
        owner: args.owner as string,
        repo: args.repo as string,
        issueNumber: args.issueNumber as number,
        projectId: args.projectId as string | undefined,
      }),
  },
  {
    name: 'github_get_issue_comments',
    description: 'Get all comments on a GitHub issue.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner' },
        repo: { type: 'string', description: 'Repository name' },
        issueNumber: { type: 'number', description: 'Issue number' },
        projectId: { type: 'string', description: 'Optional: Discharge project ID' },
      },
      required: ['owner', 'repo', 'issueNumber'],
    },
    handler: (args) =>
      getIssueComments({
        owner: args.owner as string,
        repo: args.repo as string,
        issueNumber: args.issueNumber as number,
        projectId: args.projectId as string | undefined,
      }),
  },
  {
    name: 'github_get_issue_events',
    description:
      'Get timeline events for a GitHub issue (labels, references, assignments, etc.).',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner' },
        repo: { type: 'string', description: 'Repository name' },
        issueNumber: { type: 'number', description: 'Issue number' },
        projectId: { type: 'string', description: 'Optional: Discharge project ID' },
      },
      required: ['owner', 'repo', 'issueNumber'],
    },
    handler: (args) =>
      getIssueEvents({
        owner: args.owner as string,
        repo: args.repo as string,
        issueNumber: args.issueNumber as number,
        projectId: args.projectId as string | undefined,
      }),
  },
  {
    name: 'github_search_issues',
    description:
      'Search for issues in a repository with optional filters for state, labels, and query.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner' },
        repo: { type: 'string', description: 'Repository name' },
        query: { type: 'string', description: 'Search query' },
        state: {
          type: 'string',
          enum: ['open', 'closed', 'all'],
          description: 'Issue state filter (default: open)',
        },
        labels: { type: 'string', description: 'Comma-separated list of labels' },
        limit: { type: 'number', description: 'Max issues to return (default: 30)' },
        projectId: { type: 'string', description: 'Optional: Discharge project ID' },
      },
      required: ['owner', 'repo'],
    },
    handler: (args) =>
      searchIssues({
        owner: args.owner as string,
        repo: args.repo as string,
        query: args.query as string | undefined,
        state: (args.state as 'open' | 'closed' | 'all') ?? 'open',
        labels: args.labels as string | undefined,
        limit: (args.limit as number) ?? 30,
        projectId: args.projectId as string | undefined,
      }),
  },
  {
    name: 'github_get_repo_issues',
    description: 'List issues in a repository with optional state filter.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner' },
        repo: { type: 'string', description: 'Repository name' },
        state: {
          type: 'string',
          enum: ['open', 'closed', 'all'],
          description: 'Issue state filter (default: open)',
        },
        limit: { type: 'number', description: 'Max issues to return (default: 30)' },
        projectId: { type: 'string', description: 'Optional: Discharge project ID' },
      },
      required: ['owner', 'repo'],
    },
    handler: (args) =>
      getRepoIssues({
        owner: args.owner as string,
        repo: args.repo as string,
        state: (args.state as 'open' | 'closed' | 'all') ?? 'open',
        limit: (args.limit as number) ?? 30,
        projectId: args.projectId as string | undefined,
      }),
  },
  {
    name: 'github_get_pr',
    description: 'Get full details for a GitHub pull request.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner' },
        repo: { type: 'string', description: 'Repository name' },
        pullNumber: { type: 'number', description: 'Pull request number' },
        projectId: { type: 'string', description: 'Optional: Discharge project ID' },
      },
      required: ['owner', 'repo', 'pullNumber'],
    },
    handler: (args) =>
      getPullRequest({
        owner: args.owner as string,
        repo: args.repo as string,
        pullNumber: args.pullNumber as number,
        projectId: args.projectId as string | undefined,
      }),
  },
  {
    name: 'github_get_pr_diff',
    description: 'Get the diff/patch for a GitHub pull request.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner' },
        repo: { type: 'string', description: 'Repository name' },
        pullNumber: { type: 'number', description: 'Pull request number' },
        projectId: { type: 'string', description: 'Optional: Discharge project ID' },
      },
      required: ['owner', 'repo', 'pullNumber'],
    },
    handler: (args) =>
      getPullRequestDiff({
        owner: args.owner as string,
        repo: args.repo as string,
        pullNumber: args.pullNumber as number,
        projectId: args.projectId as string | undefined,
      }),
  },
  {
    name: 'github_get_pr_reviews',
    description: 'Get reviews for a GitHub pull request.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner' },
        repo: { type: 'string', description: 'Repository name' },
        pullNumber: { type: 'number', description: 'Pull request number' },
        projectId: { type: 'string', description: 'Optional: Discharge project ID' },
      },
      required: ['owner', 'repo', 'pullNumber'],
    },
    handler: (args) =>
      getPullRequestReviews({
        owner: args.owner as string,
        repo: args.repo as string,
        pullNumber: args.pullNumber as number,
        projectId: args.projectId as string | undefined,
      }),
  },
];
