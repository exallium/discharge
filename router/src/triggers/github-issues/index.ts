import crypto from 'crypto';
import { TriggerPlugin, TriggerEvent, Tool, FixStatus, WebhookRequest } from '../base';
import { findProjectByRepo } from '../../config/projects';
import type { ProjectConfig } from '../../db/repositories/projects';
import {
  GitHubIssueEventPayload,
  GitHubIssueCommentEventPayload,
  GitHubPullRequestReviewEventPayload,
  GitHubPullRequestReviewCommentEventPayload,
  GitHubLabel,
  GitHubWebhookPayload,
  isIssueEvent,
  isIssueCommentEvent,
  isPullRequestReviewEvent,
  isPullRequestReviewCommentEvent,
} from '../../types/webhooks/github';
import { getErrorMessage } from '../../types/errors';
import type { ConversationEvent } from '../../types/conversation';
import { DEFAULT_ROUTING_TAGS } from '../../types/conversation';

/**
 * GitHub Issues trigger plugin
 * Handles GitHub issue webhooks with configurable control mechanisms
 *
 * Control Mechanisms (prevents token drain):
 * 1. Label-based filtering: Only process issues with specific labels
 * 2. Comment-based manual trigger: Require explicit comment like "/claude fix"
 * 3. User allowlist: Only specific users can trigger via comment
 *
 * Webhook setup:
 * 1. In GitHub repo settings, go to "Webhooks"
 * 2. Set webhook URL to: https://your-domain/webhooks/github-issues
 * 3. Select events: "Issues", "Issue comments"
 * 4. Set secret (required for security)
 */
export class GitHubIssuesTrigger implements TriggerPlugin {
  id = 'github-issues';
  type = 'github-issues';

  // Conversation support
  supportsConversation = true;

  /**
   * Get header value from WebhookRequest
   */
  private getHeader(req: WebhookRequest, name: string): string | null {
    return req.headers.get(name);
  }

  /**
   * Validate GitHub webhook signature
   * https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries
   */
  async validateWebhook(req: WebhookRequest): Promise<boolean> {
    const signature = this.getHeader(req, 'x-hub-signature-256');

    if (!signature) {
      console.warn('[GitHubIssuesTrigger] No signature provided - rejecting webhook');
      return false;
    }

    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    if (!secret) {
      console.error('[GitHubIssuesTrigger] GITHUB_WEBHOOK_SECRET not set');
      return false;
    }

    const body = JSON.stringify(req.body);
    const expectedSignature = 'sha256=' + crypto
      .createHmac('sha256', secret)
      .update(body)
      .digest('hex');

    // Timing-safe comparison requires same-length buffers
    if (signature.length !== expectedSignature.length) {
      return false;
    }

    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  }

  /**
   * Parse GitHub webhook payload into normalized TriggerEvent
   */
  async parseWebhook(payload: unknown): Promise<TriggerEvent | null> {
    const typedPayload = payload as GitHubWebhookPayload;
    const action = typedPayload.action;

    // Handle issue events (opened, labeled)
    if (isIssueEvent(typedPayload) && ['opened', 'labeled', 'reopened'].includes(action)) {
      return this.parseIssueEvent(typedPayload as GitHubIssueEventPayload);
    }

    // Handle comment events (manual trigger)
    if (isIssueCommentEvent(typedPayload) && action === 'created') {
      return this.parseCommentEvent(typedPayload as GitHubIssueCommentEventPayload);
    }

    console.log(`[GitHubIssuesTrigger] Ignoring action: ${action}`);
    return null;
  }

  /**
   * Parse issue opened/labeled event
   */
  private async parseIssueEvent(payload: GitHubIssueEventPayload): Promise<TriggerEvent | null> {
    const { issue, repository, action } = payload;

    if (!issue || !repository) {
      console.error('[GitHubIssuesTrigger] Missing issue or repository data');
      return null;
    }

    // Find project configuration
    const repoFullName = repository.full_name; // owner/repo
    const project = await findProjectByRepo(repoFullName);

    if (!project) {
      console.log(`[GitHubIssuesTrigger] No project configured for repo: ${repoFullName}`);
      return null;
    }

    const githubConfig = project.triggers.github;
    if (!githubConfig?.issues) {
      console.log(`[GitHubIssuesTrigger] GitHub issues trigger not enabled for: ${repoFullName}`);
      return null;
    }

    // Check label requirements
    const issueLabels = (issue.labels || []).map((l: GitHubLabel) => l.name);

    if (githubConfig.requireLabel) {
      // If requireLabel is true, issue MUST have one of the specified labels
      const hasRequiredLabel = githubConfig.labels?.some(label => issueLabels.includes(label));

      if (!hasRequiredLabel) {
        console.log(
          `[GitHubIssuesTrigger] Issue #${issue.number} doesn't have required label. ` +
          `Required: ${githubConfig.labels?.join(', ')}, Has: ${issueLabels.join(', ')}`
        );
        return null;
      }
    } else if (githubConfig.labels && githubConfig.labels.length > 0) {
      // If labels are specified but not required, check if we should process
      const hasMatchingLabel = githubConfig.labels.some(label => issueLabels.includes(label));

      if (!hasMatchingLabel && action === 'opened') {
        // For newly opened issues, don't process unless they have a matching label
        console.log(
          `[GitHubIssuesTrigger] Issue #${issue.number} opened without trigger label. ` +
          `Will process if label is added later.`
        );
        return null;
      }
    }

    // Build trigger event
    return {
      triggerType: 'github-issues',
      triggerId: `${repository.full_name}#${issue.number}`,
      projectId: project.id,
      title: `GitHub Issue #${issue.number}: ${issue.title}`,
      description: issue.body || 'No description provided',
      metadata: {
        severity: this.determineSeverity(issueLabels),
        issueNumber: issue.number,
        issueUrl: issue.html_url,
        labels: issueLabels,
        author: issue.user?.login,
        createdAt: issue.created_at,
        state: issue.state,
      },
      links: {
        web: issue.html_url,
      },
      raw: payload,
    };
  }

  /**
   * Parse issue comment event (manual trigger)
   */
  private async parseCommentEvent(payload: GitHubIssueCommentEventPayload): Promise<TriggerEvent | null> {
    const { comment, issue, repository } = payload;

    if (!comment || !issue || !repository) {
      console.error('[GitHubIssuesTrigger] Missing comment, issue, or repository data');
      return null;
    }

    // Find project configuration
    const repoFullName = repository.full_name;
    const project = await findProjectByRepo(repoFullName);

    if (!project) {
      console.log(`[GitHubIssuesTrigger] No project configured for repo: ${repoFullName}`);
      return null;
    }

    const githubConfig = project.triggers.github;
    if (!githubConfig?.issues) {
      console.log(`[GitHubIssuesTrigger] GitHub issues trigger not enabled for: ${repoFullName}`);
      return null;
    }

    // Check if comment trigger is configured
    if (!githubConfig.commentTrigger) {
      console.log(`[GitHubIssuesTrigger] Comment trigger not configured for: ${repoFullName}`);
      return null;
    }

    // Check if comment contains trigger phrase
    const commentBody = comment.body || '';
    if (!commentBody.includes(githubConfig.commentTrigger)) {
      console.log(
        `[GitHubIssuesTrigger] Comment doesn't contain trigger phrase: "${githubConfig.commentTrigger}"`
      );
      return null;
    }

    // Check if user is allowed to trigger
    const commenter = comment.user?.login;
    if (githubConfig.allowedUsers && githubConfig.allowedUsers.length > 0) {
      if (!commenter || !githubConfig.allowedUsers.includes(commenter)) {
        console.warn(
          `[GitHubIssuesTrigger] User ${commenter} not in allowedUsers list. ` +
          `Allowed: ${githubConfig.allowedUsers.join(', ')}`
        );
        return null;
      }
    }

    console.log(
      `[GitHubIssuesTrigger] Manual trigger from ${commenter} on issue #${issue.number}`
    );

    // Build trigger event (similar to issue event)
    const issueLabels = (issue.labels || []).map((l: GitHubLabel) => l.name);

    return {
      triggerType: 'github-issues',
      triggerId: `${repository.full_name}#${issue.number}-comment-${comment.id}`,
      projectId: project.id,
      title: `GitHub Issue #${issue.number}: ${issue.title}`,
      description: issue.body || 'No description provided',
      metadata: {
        severity: this.determineSeverity(issueLabels),
        issueNumber: issue.number,
        issueUrl: issue.html_url,
        labels: issueLabels,
        author: issue.user?.login,
        triggeredBy: commenter,
        triggerComment: commentBody,
        triggerCommentUrl: comment.html_url,
        createdAt: issue.created_at,
        state: issue.state,
      },
      links: {
        web: issue.html_url,
      },
      raw: payload,
    };
  }

  /**
   * Determine severity from issue labels
   */
  private determineSeverity(labels: string[]): 'critical' | 'high' | 'medium' | 'low' {
    const labelLower = labels.map(l => l.toLowerCase());

    if (labelLower.some(l => ['critical', 'urgent', 'blocker'].includes(l))) {
      return 'critical';
    }
    if (labelLower.some(l => ['bug', 'high', 'high-priority'].includes(l))) {
      return 'high';
    }
    if (labelLower.some(l => ['medium', 'enhancement'].includes(l))) {
      return 'medium';
    }
    return 'low';
  }

  /**
   * Check if this event should be processed
   */
  async shouldProcess(event: TriggerEvent): Promise<boolean> {
    // Only process open issues
    const state = event.metadata.state;
    if (state !== 'open') {
      console.log(`[GitHubIssuesTrigger] Skipping ${state} issue: ${event.triggerId}`);
      return false;
    }

    return true;
  }

  /**
   * Generate prompt context for Claude
   */
  getPromptContext(event: TriggerEvent): string {
    const issueNumber = event.metadata.issueNumber as number;
    const issueUrl = event.metadata.issueUrl as string;
    const labels = event.metadata.labels as string[] | undefined;
    const author = event.metadata.author as string;
    const triggeredBy = event.metadata.triggeredBy as string | undefined;
    const repoFullName = event.triggerId.split('#')[0];

    let context = `# GitHub Issue #${issueNumber}\n\n`;
    context += `**Repository:** ${repoFullName}\n`;
    context += `**Issue URL:** ${issueUrl}\n`;
    context += `**Reporter:** @${author}\n`;

    if (triggeredBy) {
      context += `**Triggered by:** @${triggeredBy} (via comment)\n`;
    }

    if (labels && labels.length > 0) {
      context += `**Labels:** ${labels.join(', ')}\n`;
    }

    context += `\n## Description\n\n${event.description}\n\n`;

    context += `## Investigation\n\n`;
    context += `You have access to these tools for investigation:\n`;
    context += `- \`get-issue-details\` - Fetch full issue metadata\n`;
    context += `- \`get-issue-comments\` - Read all discussion comments\n`;
    context += `- \`get-issue-events\` - View timeline (labels, references, etc.)\n`;
    context += `- \`search-related-issues\` - Find similar issues\n`;
    context += `- \`get-repo-issues\` - See recent issues for context\n\n`;

    context += `Please investigate this issue and attempt to create a fix if possible.\n`;

    return context;
  }

  /**
   * Get web link to the issue
   */
  getLink(event: TriggerEvent): string {
    const issueUrl = event.metadata.issueUrl as string | undefined;
    return issueUrl || event.links?.web || '';
  }

  /**
   * Generate investigation tools for GitHub issues
   */
  getTools(event: TriggerEvent): Tool[] {
    const { issueNumber } = event.metadata;
    const repoFullName = event.triggerId.split('#')[0];
    const [owner, repo] = repoFullName.split('/');

    const tools: Tool[] = [
      {
        name: 'get-issue-details',
        description: 'Fetch full issue details including all comments and metadata',
        script: `#!/bin/bash
# Get detailed issue information from GitHub API
curl -s -H "Authorization: Bearer $GITHUB_TOKEN" \\
  -H "Accept: application/vnd.github+json" \\
  "https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}" | jq '.'
`,
      },
      {
        name: 'get-issue-comments',
        description: 'Fetch all comments on the issue',
        script: `#!/bin/bash
# Get all comments on the issue
curl -s -H "Authorization: Bearer $GITHUB_TOKEN" \\
  -H "Accept: application/vnd.github+json" \\
  "https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments" | jq '.'
`,
      },
      {
        name: 'get-issue-events',
        description: 'Fetch issue timeline events (labels, assignments, references, etc.)',
        script: `#!/bin/bash
# Get issue timeline events
curl -s -H "Authorization: Bearer $GITHUB_TOKEN" \\
  -H "Accept: application/vnd.github+json" \\
  "https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/events" | jq '.'
`,
      },
      {
        name: 'search-related-issues',
        description: 'Search for related issues in the repository',
        script: `#!/bin/bash
# Search for related issues based on key terms from the issue title
# Extract key terms from title (remove common words)
TITLE=$(curl -s -H "Authorization: Bearer $GITHUB_TOKEN" \\
  -H "Accept: application/vnd.github+json" \\
  "https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}" | jq -r '.title')

# Search for similar issues
curl -s -H "Authorization: Bearer $GITHUB_TOKEN" \\
  -H "Accept: application/vnd.github+json" \\
  "https://api.github.com/search/issues?q=repo:${owner}/${repo}+\${TITLE// /+}" | jq '.items[] | {number, title, state, html_url}'
`,
      },
      {
        name: 'get-repo-issues',
        description: 'Get recent open issues in the repository for context',
        script: `#!/bin/bash
# Get recent open issues
curl -s -H "Authorization: Bearer $GITHUB_TOKEN" \\
  -H "Accept: application/vnd.github+json" \\
  "https://api.github.com/repos/${owner}/${repo}/issues?state=open&per_page=10" | jq '.[] | {number, title, labels: [.labels[].name], created_at}'
`,
      },
    ];

    return tools;
  }

  /**
   * Update status (post final result comment to issue)
   */
  async updateStatus(event: TriggerEvent, status: FixStatus): Promise<void> {
    const { issueNumber } = event.metadata;
    const repoFullName = event.triggerId.split('#')[0];
    const [owner, repo] = repoFullName.split('/');

    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      console.error('[GitHubIssuesTrigger] GITHUB_TOKEN not set');
      return;
    }

    let comment = '';

    if (status.fixed) {
      // Success case
      comment = `✅ Fix completed successfully!\n\n`;

      if (status.prUrl) {
        comment += `Pull request: ${status.prUrl}\n\n`;
      }

      if (status.analysis) {
        comment += `**Analysis Summary:**\n${status.analysis.summary}\n\n`;
        comment += `**Root Cause:**\n${status.analysis.rootCause}\n\n`;

        if (status.analysis.filesInvolved.length > 0) {
          comment += `**Files Modified:**\n`;
          status.analysis.filesInvolved.forEach(file => {
            comment += `- ${file}\n`;
          });
        }
      }
    } else {
      // Failure case
      comment = `❌ Unable to automatically fix this issue.\n\n`;

      if (status.reason) {
        comment += `**Reason:** ${status.reason}\n\n`;
      }

      if (status.analysis) {
        comment += `**Analysis:**\n${status.analysis.summary}\n\n`;

        if (status.analysis.reason) {
          comment += `**Why auto-fix failed:** ${status.analysis.reason}\n\n`;
        }

        if (status.analysis.proposedFix) {
          comment += `**Suggested approach:**\n${status.analysis.proposedFix}\n`;
        }
      }
    }

    try {
      await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ body: comment }),
      });

      console.log(`[GitHubIssuesTrigger] Posted ${status.fixed ? 'success' : 'failure'} comment to issue #${issueNumber}`);
    } catch (error: unknown) {
      console.error(`[GitHubIssuesTrigger] Failed to post comment:`, getErrorMessage(error));
    }
  }

  /**
   * Add comment to issue
   */
  async addComment(event: TriggerEvent, comment: string): Promise<void> {
    const { issueNumber } = event.metadata;
    const repoFullName = event.triggerId.split('#')[0];
    const [owner, repo] = repoFullName.split('/');

    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      console.error('[GitHubIssuesTrigger] GITHUB_TOKEN not set');
      return;
    }

    try {
      await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ body: comment }),
      });

      console.log(`[GitHubIssuesTrigger] Posted comment to issue #${issueNumber}`);
    } catch (error: unknown) {
      console.error(`[GitHubIssuesTrigger] Failed to post comment:`, getErrorMessage(error));
    }
  }

  // ========================================
  // Conversation Support Methods
  // ========================================

  /**
   * Parse webhook payload into a ConversationEvent
   * Handles: issue_opened, issue_comment, issue_labeled, pr_review, pr_review_comment
   */
  async parseConversationEvent(
    payload: unknown,
    project?: ProjectConfig
  ): Promise<ConversationEvent | null> {
    const typedPayload = payload as GitHubWebhookPayload;

    // Handle issue opened
    if (isIssueEvent(typedPayload) && typedPayload.action === 'opened') {
      return this.parseIssueOpenedConversationEvent(typedPayload);
    }

    // Handle issue labeled
    if (isIssueEvent(typedPayload) && typedPayload.action === 'labeled') {
      return this.parseIssueLabeledConversationEvent(typedPayload);
    }

    // Handle issue comment
    if (isIssueCommentEvent(typedPayload) && typedPayload.action === 'created') {
      return this.parseIssueCommentConversationEvent(typedPayload);
    }

    // Handle PR review
    if (isPullRequestReviewEvent(typedPayload) && typedPayload.action === 'submitted') {
      return this.parsePRReviewConversationEvent(typedPayload);
    }

    // Handle PR review comment
    if (isPullRequestReviewCommentEvent(typedPayload) && typedPayload.action === 'created') {
      return this.parsePRReviewCommentConversationEvent(typedPayload);
    }

    return null;
  }

  /**
   * Parse issue opened event to ConversationEvent
   */
  private parseIssueOpenedConversationEvent(
    payload: GitHubIssueEventPayload
  ): ConversationEvent {
    const { issue, repository } = payload;
    const issueLabels = (issue.labels || []).map((l: GitHubLabel) => l.name);

    return {
      type: 'issue_opened',
      source: {
        platform: 'github',
        externalId: `${repository.full_name}#${issue.number}`,
        url: issue.html_url,
      },
      target: {
        type: 'issue',
        number: issue.number,
        title: issue.title,
        body: issue.body || '',
        labels: issueLabels,
        url: issue.html_url,
      },
      payload: {
        action: 'opened',
      },
      timestamp: new Date(issue.created_at).toISOString(),
    };
  }

  /**
   * Parse issue labeled event to ConversationEvent
   */
  private parseIssueLabeledConversationEvent(
    payload: GitHubIssueEventPayload
  ): ConversationEvent {
    const { issue, repository, label } = payload;
    const issueLabels = (issue.labels || []).map((l: GitHubLabel) => l.name);

    return {
      type: 'issue_labeled',
      source: {
        platform: 'github',
        externalId: `${repository.full_name}#${issue.number}`,
        url: issue.html_url,
      },
      target: {
        type: 'issue',
        number: issue.number,
        title: issue.title,
        body: issue.body || '',
        labels: issueLabels,
        url: issue.html_url,
      },
      payload: {
        action: 'labeled',
        label: label ? { name: label.name, color: label.color } : undefined,
      },
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Parse issue comment event to ConversationEvent
   */
  private parseIssueCommentConversationEvent(
    payload: GitHubIssueCommentEventPayload
  ): ConversationEvent {
    const { issue, comment, repository } = payload;
    const issueLabels = (issue.labels || []).map((l: GitHubLabel) => l.name);

    return {
      type: 'issue_comment',
      source: {
        platform: 'github',
        externalId: `${repository.full_name}#${issue.number}`,
        url: comment.html_url,
      },
      target: {
        type: 'issue',
        number: issue.number,
        title: issue.title,
        body: issue.body || '',
        labels: issueLabels,
        url: issue.html_url,
      },
      payload: {
        action: 'created',
        comment: {
          id: String(comment.id),
          body: comment.body,
          author: comment.user?.login || 'unknown',
          url: comment.html_url,
        },
      },
      timestamp: new Date(comment.created_at).toISOString(),
    };
  }

  /**
   * Parse PR review event to ConversationEvent
   */
  private parsePRReviewConversationEvent(
    payload: GitHubPullRequestReviewEventPayload
  ): ConversationEvent {
    const { pull_request, review, repository } = payload;
    const prLabels = (pull_request.labels || []).map((l: GitHubLabel) => l.name);

    return {
      type: 'pr_review',
      source: {
        platform: 'github',
        externalId: `${repository.full_name}#${pull_request.number}`,
        url: review.html_url,
      },
      target: {
        type: 'pull_request',
        number: pull_request.number,
        title: pull_request.title,
        body: pull_request.body || '',
        labels: prLabels,
        url: pull_request.html_url,
      },
      payload: {
        action: 'submitted',
        review: {
          id: String(review.id),
          state: review.state,
          body: review.body || '',
          author: review.user?.login || 'unknown',
          url: review.html_url,
        },
      },
      timestamp: new Date(review.submitted_at).toISOString(),
    };
  }

  /**
   * Parse PR review comment event to ConversationEvent
   */
  private parsePRReviewCommentConversationEvent(
    payload: GitHubPullRequestReviewCommentEventPayload
  ): ConversationEvent {
    const { pull_request, comment, repository } = payload;
    const prLabels = (pull_request.labels || []).map((l: GitHubLabel) => l.name);

    return {
      type: 'pr_review_comment',
      source: {
        platform: 'github',
        externalId: `${repository.full_name}#${pull_request.number}`,
        url: comment.html_url,
      },
      target: {
        type: 'pull_request',
        number: pull_request.number,
        title: pull_request.title,
        body: pull_request.body || '',
        labels: prLabels,
        url: pull_request.html_url,
      },
      payload: {
        action: 'created',
        comment: {
          id: String(comment.id),
          body: comment.body,
          author: comment.user?.login || 'unknown',
          url: comment.html_url,
        },
        reviewComments: [
          {
            id: String(comment.id),
            path: comment.path,
            line: comment.line || undefined,
            body: comment.body,
            author: comment.user?.login || 'unknown',
            diffHunk: comment.diff_hunk,
          },
        ],
      },
      timestamp: new Date(comment.created_at).toISOString(),
    };
  }

  /**
   * Get unique conversation identifier from trigger event
   * Format: owner/repo#number
   */
  getConversationId(event: TriggerEvent): string {
    const issueNumber = event.metadata.issueNumber as number;
    const repoFullName = event.triggerId.split('#')[0];
    return `${repoFullName}#${issueNumber}`;
  }

  /**
   * Get routing tags from trigger event labels
   * Checks for ai:plan, ai:auto, ai:assist tags
   */
  getRoutingTags(event: TriggerEvent): string[] {
    const labels = event.metadata.labels as string[] | undefined;
    if (!labels) return [];

    // Filter for routing tags
    const routingTagValues: string[] = [
      DEFAULT_ROUTING_TAGS.plan,
      DEFAULT_ROUTING_TAGS.auto,
      DEFAULT_ROUTING_TAGS.assist,
    ];
    return labels.filter(label => routingTagValues.includes(label));
  }

  /**
   * Post feedback/reply to the trigger's platform
   * Posts a comment on the GitHub issue or PR
   */
  async postFeedback(
    event: TriggerEvent,
    message: string,
    project?: ProjectConfig
  ): Promise<void> {
    // Use the existing addComment method
    await this.addComment(event, message);
  }
}
