/**
 * GitHub webhook payload types
 * Based on GitHub Webhook Events and Payloads documentation
 */

/**
 * GitHub User (simplified)
 */
export interface GitHubUser {
  login: string;
  id: number;
  avatar_url?: string;
  type?: string;
}

/**
 * GitHub Label
 */
export interface GitHubLabel {
  id: number;
  name: string;
  color?: string;
  description?: string;
}

/**
 * GitHub Repository
 */
export interface GitHubRepository {
  id: number;
  name: string;
  full_name: string;
  owner: GitHubUser;
  private: boolean;
  html_url: string;
  description?: string | null;
  default_branch: string;
  clone_url?: string;
}

/**
 * GitHub Issue
 */
export interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  html_url: string;
  user: GitHubUser | null;
  labels: GitHubLabel[];
  assignees?: GitHubUser[];
  milestone?: {
    title: string;
    number: number;
  } | null;
  created_at: string;
  updated_at: string;
  closed_at?: string | null;
}

/**
 * GitHub Comment
 */
export interface GitHubComment {
  id: number;
  body: string;
  html_url: string;
  user: GitHubUser | null;
  created_at: string;
  updated_at: string;
}

/**
 * GitHub Pull Request
 */
export interface GitHubPullRequest {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed' | 'merged';
  html_url: string;
  user: GitHubUser | null;
  head: {
    ref: string;
    sha: string;
  };
  base: {
    ref: string;
    sha: string;
  };
  merged: boolean;
  mergeable?: boolean | null;
  draft: boolean;
  labels: GitHubLabel[];
  created_at: string;
  updated_at: string;
  closed_at?: string | null;
  merged_at?: string | null;
}

/**
 * GitHub Issue Event Payload
 */
export interface GitHubIssueEventPayload {
  action: 'opened' | 'edited' | 'deleted' | 'pinned' | 'unpinned' | 'closed' | 'reopened' | 'assigned' | 'unassigned' | 'labeled' | 'unlabeled' | 'locked' | 'unlocked' | 'transferred' | 'milestoned' | 'demilestoned';
  issue: GitHubIssue;
  repository: GitHubRepository;
  sender: GitHubUser;
  label?: GitHubLabel;
}

/**
 * GitHub Issue Comment Event Payload
 */
export interface GitHubIssueCommentEventPayload {
  action: 'created' | 'edited' | 'deleted';
  issue: GitHubIssue;
  comment: GitHubComment;
  repository: GitHubRepository;
  sender: GitHubUser;
}

/**
 * GitHub Pull Request Event Payload
 */
export interface GitHubPullRequestEventPayload {
  action: 'opened' | 'edited' | 'closed' | 'reopened' | 'assigned' | 'unassigned' | 'review_requested' | 'review_request_removed' | 'labeled' | 'unlabeled' | 'synchronize' | 'converted_to_draft' | 'ready_for_review' | 'locked' | 'unlocked';
  number: number;
  pull_request: GitHubPullRequest;
  repository: GitHubRepository;
  sender: GitHubUser;
  label?: GitHubLabel;
}

/**
 * Union type for all GitHub webhook payloads we handle
 */
export type GitHubWebhookPayload =
  | GitHubIssueEventPayload
  | GitHubIssueCommentEventPayload
  | GitHubPullRequestEventPayload;

/**
 * Type guard for issue event
 */
export function isIssueEvent(payload: GitHubWebhookPayload): payload is GitHubIssueEventPayload {
  return 'issue' in payload && !('comment' in payload) && !('pull_request' in payload);
}

/**
 * Type guard for issue comment event
 */
export function isIssueCommentEvent(payload: GitHubWebhookPayload): payload is GitHubIssueCommentEventPayload {
  return 'issue' in payload && 'comment' in payload;
}

/**
 * Type guard for pull request event
 */
export function isPullRequestEvent(payload: GitHubWebhookPayload): payload is GitHubPullRequestEventPayload {
  return 'pull_request' in payload;
}
