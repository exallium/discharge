import crypto from 'crypto';
import { TriggerPlugin, TriggerEvent, Tool, FixStatus, WebhookRequest, WebhookConfig, SecretRequirement } from '../base';
import { findProjectByRepo } from '../../config/projects';
import type { ProjectConfig } from '../../db/repositories/projects';
import { getGitHubToken, getGitHubWebhookSecret } from '../../vcs';
import { getAppCredentials } from '../../github/app-service';
import {
  GitHubIssueEventPayload,
  GitHubIssueCommentEventPayload,
  GitHubPullRequestEventPayload,
  GitHubPullRequestReviewEventPayload,
  GitHubPullRequestReviewCommentEventPayload,
  GitHubLabel,
  GitHubWebhookPayload,
  isIssueEvent,
  isIssueCommentEvent,
  isPullRequestEvent,
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

  webhookConfig: WebhookConfig = {
    events: ['issues', 'issue_comment', 'pull_request', 'pull_request_review', 'pull_request_review_comment'],
    docsUrl: 'https://docs.github.com/en/webhooks/using-webhooks/creating-webhooks',
  };

  // Label that triggers plan approval and execution
  static readonly PLAN_APPROVED_LABEL = 'plan-approved';

  // Escalation labels for agent routing
  static readonly ESCALATE_COMPLEX_LABEL = 'escalate-complex';
  static readonly ESCALATE_INVESTIGATE_LABEL = 'escalate-investigate';
  static readonly RERUN_TRIAGE_LABEL = 'rerun-triage';

  // Triage-applied labels
  static readonly COMPLEXITY_SIMPLE_LABEL = 'complexity-simple';
  static readonly COMPLEXITY_COMPLEX_LABEL = 'complexity-complex';
  static readonly NEEDS_INFO_LABEL = 'needs-info';
  static readonly OUT_OF_SCOPE_LABEL = 'out-of-scope';

  // All escalation labels for easy checking
  static readonly ESCALATION_LABELS = [
    GitHubIssuesTrigger.ESCALATE_COMPLEX_LABEL,
    GitHubIssuesTrigger.ESCALATE_INVESTIGATE_LABEL,
    GitHubIssuesTrigger.RERUN_TRIAGE_LABEL,
  ];

  // Conversation support
  supportsConversation = true;

  // Cached bot username (computed once from app credentials)
  private cachedBotUsername: string | null = null;

  /**
   * Get the bot username from GitHub App credentials
   * The bot username is {appSlug}[bot]
   */
  private async getBotUsername(): Promise<string | null> {
    if (this.cachedBotUsername) {
      return this.cachedBotUsername;
    }

    const credentials = await getAppCredentials();
    if (!credentials?.appSlug) {
      return null;
    }

    this.cachedBotUsername = `${credentials.appSlug}[bot]`;
    return this.cachedBotUsername;
  }

  /**
   * Check if the sender is the bot itself
   * Used to prevent the bot from triggering on its own actions
   */
  private async isBotSender(senderLogin: string | undefined): Promise<boolean> {
    if (!senderLogin) {
      return false;
    }

    const botUsername = await this.getBotUsername();
    if (!botUsername) {
      return false;
    }

    return senderLogin.toLowerCase() === botUsername.toLowerCase();
  }

  /**
   * Get the secrets required by this trigger
   * Note: GitHub token is no longer required - we use the GitHub App installation token
   */
  getRequiredSecrets(): SecretRequirement[] {
    // No secrets required when using GitHub App
    // The webhook secret is stored in the app credentials
    // The API token is generated from the app installation
    return [];
  }

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

    // Extract repository from payload to look up project-specific secret
    const payload = req.body as GitHubWebhookPayload;
    const repoFullName = payload?.repository?.full_name;
    let projectId: string | undefined;

    if (repoFullName) {
      const project = await findProjectByRepo(repoFullName);
      projectId = project?.id;
    }

    const secret = await getGitHubWebhookSecret(projectId);
    if (!secret) {
      console.error('[GitHubIssuesTrigger] GITHUB_WEBHOOK_SECRET not configured' +
        (projectId ? ` for project ${projectId}` : ' (global)'));
      return false;
    }

    // Use raw body for signature verification (JSON.stringify may produce different output)
    const body = req.rawBody ?? JSON.stringify(req.body);
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

    // Check if this event was triggered by the bot itself - ignore to prevent loops
    const sender = (typedPayload as { sender?: { login: string } }).sender;
    if (await this.isBotSender(sender?.login)) {
      console.log(`[GitHubIssuesTrigger] Ignoring event from bot: ${sender?.login}`);
      return null;
    }

    // Handle issue events (opened, labeled)
    if (isIssueEvent(typedPayload) && ['opened', 'labeled', 'reopened'].includes(action)) {
      return this.parseIssueEvent(typedPayload as GitHubIssueEventPayload);
    }

    // Handle comment events (manual trigger)
    if (isIssueCommentEvent(typedPayload) && action === 'created') {
      return this.parseCommentEvent(typedPayload as GitHubIssueCommentEventPayload);
    }

    // Handle PR review events (for conversation mode)
    if (isPullRequestReviewEvent(typedPayload) && action === 'submitted') {
      return this.parsePRReviewEvent(typedPayload as GitHubPullRequestReviewEventPayload);
    }

    // Handle PR review comment events (for conversation mode)
    if (isPullRequestReviewCommentEvent(typedPayload) && action === 'created') {
      return this.parsePRReviewCommentEvent(typedPayload as GitHubPullRequestReviewCommentEventPayload);
    }

    // Handle PR labeled events (for plan approval)
    if (isPullRequestEvent(typedPayload) && action === 'labeled') {
      return this.parsePRLabeledEvent(typedPayload as GitHubPullRequestEventPayload);
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
   * Parse issue comment event (manual trigger or PR conversation)
   * Note: GitHub sends issue_comment events for both issues AND PRs (PRs are issues)
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

    // Check if this is a PR comment (PRs have pull_request URL in the issue object)
    const isPRComment = !!(issue as { pull_request?: { url: string } }).pull_request;

    // For actual issues, require github-issues trigger to be enabled
    // For PR comments, we always process (GitHub App handles PR conversations)
    const githubConfig = project.triggers.github;
    if (!isPRComment && !githubConfig?.issues) {
      console.log(`[GitHubIssuesTrigger] GitHub issues trigger not enabled for: ${repoFullName}`);
      return null;
    }

    const commentBody = comment.body || '';
    const commenter = comment.user?.login;

    // For issue comments (not PR), require trigger phrase and user allowlist
    if (!isPRComment) {
      // Check if comment trigger is configured
      if (!githubConfig?.commentTrigger) {
        console.log(`[GitHubIssuesTrigger] Comment trigger not configured for: ${repoFullName}`);
        return null;
      }

      // Check if comment contains trigger phrase
      if (!commentBody.includes(githubConfig.commentTrigger)) {
        console.log(
          `[GitHubIssuesTrigger] Comment doesn't contain trigger phrase: "${githubConfig.commentTrigger}"`
        );
        return null;
      }

      // Check if user is allowed to trigger
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
    } else {
      // PR comment - process for conversation mode
      console.log(
        `[GitHubIssuesTrigger] PR comment from ${commenter} on PR #${issue.number}`
      );
    }

    // Build trigger event
    const issueLabels = (issue.labels || []).map((l: GitHubLabel) => l.name);

    return {
      triggerType: 'github-issues',
      triggerId: `${repository.full_name}#${issue.number}-comment-${comment.id}`,
      projectId: project.id,
      title: isPRComment
        ? `PR Comment on #${issue.number}: ${issue.title}`
        : `GitHub Issue #${issue.number}: ${issue.title}`,
      description: issue.body || 'No description provided',
      metadata: {
        severity: this.determineSeverity(issueLabels),
        // For PRs, use prNumber; for issues, use issueNumber
        ...(isPRComment
          ? { prNumber: issue.number, prUrl: issue.html_url }
          : { issueNumber: issue.number, issueUrl: issue.html_url }),
        labels: issueLabels,
        author: issue.user?.login,
        triggeredBy: commenter,
        triggerComment: commentBody,
        triggerCommentUrl: comment.html_url,
        createdAt: issue.created_at,
        state: issue.state,
        isPRComment,
      },
      links: {
        web: issue.html_url,
      },
      raw: payload,
    };
  }

  /**
   * Parse PR review event into TriggerEvent
   * Used to provide context for conversation mode routing
   */
  private async parsePRReviewEvent(payload: GitHubPullRequestReviewEventPayload): Promise<TriggerEvent | null> {
    const { pull_request, review, repository } = payload;

    if (!pull_request || !repository) {
      console.error('[GitHubIssuesTrigger] Missing pull_request or repository data');
      return null;
    }

    // Find project configuration
    const repoFullName = repository.full_name;
    const project = await findProjectByRepo(repoFullName);

    if (!project) {
      console.log(`[GitHubIssuesTrigger] No project configured for repo: ${repoFullName}`);
      return null;
    }

    const prLabels = (pull_request.labels || []).map((l: GitHubLabel) => l.name);

    // Extract linked issue number from PR body (e.g., "Fixes #123")
    const linkedIssueNumber = this.extractLinkedIssueNumber(pull_request.body);

    return {
      triggerType: 'github-issues',
      triggerId: `${repository.full_name}#${pull_request.number}-review-${review.id}`,
      projectId: project.id,
      title: `PR Review on #${pull_request.number}: ${pull_request.title}`,
      description: review.body || 'No review body',
      metadata: {
        severity: this.determineSeverity(prLabels),
        // Use linked issue number if found, so conversation routes to the original issue
        issueNumber: linkedIssueNumber || undefined,
        prNumber: pull_request.number,
        prUrl: pull_request.html_url,
        reviewId: review.id,
        reviewState: review.state,
        reviewer: review.user?.login,
        labels: prLabels,
        createdAt: review.submitted_at,
        state: pull_request.state,
      },
      links: {
        web: review.html_url,
      },
      raw: payload,
    };
  }

  /**
   * Parse PR review comment event into TriggerEvent
   * Used to provide context for conversation mode routing
   */
  private async parsePRReviewCommentEvent(payload: GitHubPullRequestReviewCommentEventPayload): Promise<TriggerEvent | null> {
    const { pull_request, comment, repository } = payload;

    if (!pull_request || !repository) {
      console.error('[GitHubIssuesTrigger] Missing pull_request or repository data');
      return null;
    }

    // Find project configuration
    const repoFullName = repository.full_name;
    const project = await findProjectByRepo(repoFullName);

    if (!project) {
      console.log(`[GitHubIssuesTrigger] No project configured for repo: ${repoFullName}`);
      return null;
    }

    const prLabels = (pull_request.labels || []).map((l: GitHubLabel) => l.name);

    // Extract linked issue number from PR body (e.g., "Fixes #123")
    const linkedIssueNumber = this.extractLinkedIssueNumber(pull_request.body);

    return {
      triggerType: 'github-issues',
      triggerId: `${repository.full_name}#${pull_request.number}-comment-${comment.id}`,
      projectId: project.id,
      title: `PR Comment on #${pull_request.number}: ${pull_request.title}`,
      description: comment.body || 'No comment body',
      metadata: {
        severity: this.determineSeverity(prLabels),
        // Use linked issue number if found, so conversation routes to the original issue
        issueNumber: linkedIssueNumber || undefined,
        prNumber: pull_request.number,
        prUrl: pull_request.html_url,
        commentId: comment.id,
        commentPath: comment.path,
        commentLine: comment.line,
        commenter: comment.user?.login,
        labels: prLabels,
        createdAt: comment.created_at,
        state: pull_request.state,
      },
      links: {
        web: comment.html_url,
      },
      raw: payload,
    };
  }

  /**
   * Parse PR labeled event
   * Used for plan approval and escalation labels
   */
  private async parsePRLabeledEvent(payload: GitHubPullRequestEventPayload): Promise<TriggerEvent | null> {
    const { pull_request, repository, label } = payload;

    if (!pull_request || !repository) {
      console.error('[GitHubIssuesTrigger] Missing pull_request or repository data');
      return null;
    }

    // Check if this is a label we care about
    const labelName = label?.name;
    const isPlanApproved = labelName === GitHubIssuesTrigger.PLAN_APPROVED_LABEL;
    const isEscalation = GitHubIssuesTrigger.ESCALATION_LABELS.includes(labelName || '');

    if (!isPlanApproved && !isEscalation) {
      console.log(`[GitHubIssuesTrigger] Ignoring label: ${labelName}`);
      return null;
    }

    if (isPlanApproved) {
      console.log(`[GitHubIssuesTrigger] Plan approved via label on PR #${pull_request.number}`);
    } else {
      console.log(`[GitHubIssuesTrigger] Escalation label ${labelName} added to PR #${pull_request.number}`);
    }

    // Find project configuration
    const repoFullName = repository.full_name;
    const project = await findProjectByRepo(repoFullName);

    if (!project) {
      console.log(`[GitHubIssuesTrigger] No project configured for repo: ${repoFullName}`);
      return null;
    }

    const prLabels = (pull_request.labels || []).map((l: GitHubLabel) => l.name);

    // Extract linked issue number from PR body (e.g., "Fixes #123")
    const linkedIssueNumber = this.extractLinkedIssueNumber(pull_request.body);

    // Determine event type based on label
    let triggerId: string;
    let title: string;
    let description: string;
    const eventMetadata: Record<string, unknown> = {
      severity: this.determineSeverity(prLabels),
      issueNumber: linkedIssueNumber || undefined,
      prNumber: pull_request.number,
      prUrl: pull_request.html_url,
      prBranch: pull_request.head?.ref,
      labels: prLabels,
      state: pull_request.state,
      owner: repository.owner?.login,
      repo: repository.name,
    };

    if (isPlanApproved) {
      triggerId = `${repository.full_name}#${pull_request.number}-plan-approved`;
      title = `Plan Approved: PR #${pull_request.number}`;
      description = `The implementation plan for PR #${pull_request.number} has been approved.`;
      eventMetadata.planApproved = true;
    } else {
      // Escalation label
      triggerId = `${repository.full_name}#${pull_request.number}-escalation-${labelName}`;
      title = `Escalation: ${labelName} on PR #${pull_request.number}`;
      description = `Escalation requested via ${labelName} label.`;
      eventMetadata.escalationLabel = labelName;
      eventMetadata.escalationType = labelName === GitHubIssuesTrigger.ESCALATE_COMPLEX_LABEL
        ? 'complex'
        : labelName === GitHubIssuesTrigger.ESCALATE_INVESTIGATE_LABEL
          ? 'investigate'
          : 'triage';
    }

    return {
      triggerType: 'github-issues',
      triggerId,
      projectId: project.id,
      title,
      description,
      metadata: eventMetadata,
      links: {
        web: pull_request.html_url,
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
   * Note: These tools use $GITHUB_TOKEN which is injected by the runner
   * from the GitHub App installation token
   */
  async getTools(event: TriggerEvent): Promise<Tool[]> {
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

    // Get token from GitHub App installation (using repo name, not project ID)
    const token = await getGitHubToken(repoFullName);
    if (!token) {
      console.error('[GitHubIssuesTrigger] No GitHub App installation for repo:', repoFullName);
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

    // Get owner/repo from metadata (conversation mode) or triggerId (standard mode)
    let owner: string;
    let repo: string;
    let repoFullName: string;
    if (event.metadata.owner && event.metadata.repo) {
      owner = event.metadata.owner as string;
      repo = event.metadata.repo as string;
      repoFullName = `${owner}/${repo}`;
    } else {
      repoFullName = event.triggerId.split('#')[0];
      [owner, repo] = repoFullName.split('/');
    }

    if (!owner || !repo || !issueNumber) {
      console.error('[GitHubIssuesTrigger] Missing required fields for comment:', { owner, repo, issueNumber });
      return;
    }

    // Get token from GitHub App installation (using repo name, not project ID)
    const token = await getGitHubToken(repoFullName);
    if (!token) {
      console.error('[GitHubIssuesTrigger] No GitHub App installation for repo:', repoFullName);
      return;
    }

    try {
      const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ body: comment }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        console.error(`[GitHubIssuesTrigger] GitHub API error ${response.status}:`, errorBody);
        return;
      }

      console.log(`[GitHubIssuesTrigger] Posted comment to ${owner}/${repo}#${issueNumber}`);
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
    _project?: ProjectConfig
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

    // Handle PR labeled (plan approval and escalation)
    if (isPullRequestEvent(typedPayload) && typedPayload.action === 'labeled') {
      const labelName = typedPayload.label?.name;

      // Handle plan-approved label
      if (labelName === GitHubIssuesTrigger.PLAN_APPROVED_LABEL) {
        return this.parsePlanApprovedConversationEvent(typedPayload);
      }

      // Handle escalation labels
      if (GitHubIssuesTrigger.ESCALATION_LABELS.includes(labelName || '')) {
        return this.parseEscalationConversationEvent(typedPayload);
      }
    }

    return null;
  }

  /**
   * Parse escalation label event to ConversationEvent
   */
  private parseEscalationConversationEvent(
    payload: GitHubPullRequestEventPayload
  ): ConversationEvent {
    const { pull_request, repository, label } = payload;
    const prLabels = (pull_request.labels || []).map((l: GitHubLabel) => l.name);
    const labelName = label?.name || '';

    // Try to link back to the originating issue
    const linkedIssueNumber = this.extractLinkedIssueNumber(pull_request.body);
    const externalId = linkedIssueNumber
      ? `${repository.full_name}#${linkedIssueNumber}`
      : `${repository.full_name}#${pull_request.number}`;

    // Determine escalation type
    let escalationType: 'complex' | 'investigate' | 'triage' = 'triage';
    if (labelName === GitHubIssuesTrigger.ESCALATE_COMPLEX_LABEL) {
      escalationType = 'complex';
    } else if (labelName === GitHubIssuesTrigger.ESCALATE_INVESTIGATE_LABEL) {
      escalationType = 'investigate';
    }

    return {
      type: 'escalation_requested',
      source: {
        platform: 'github',
        externalId,
        url: pull_request.html_url,
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
        action: 'labeled',
        label: {
          name: labelName,
        },
        escalationType,
        prBranch: pull_request.head?.ref,
      },
      timestamp: new Date().toISOString(),
    };
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
   * Extract linked issue number from PR body
   * Looks for patterns like "Fixes #123", "Closes #456", "Resolves #789"
   */
  private extractLinkedIssueNumber(prBody: string | null): number | null {
    if (!prBody) return null;

    // Match common issue-linking patterns
    const patterns = [
      /(?:fix(?:es)?|close[sd]?|resolve[sd]?)\s*#(\d+)/i,
      /(?:fix(?:es)?|close[sd]?|resolve[sd]?)\s+(?:issue\s+)?#(\d+)/i,
    ];

    for (const pattern of patterns) {
      const match = prBody.match(pattern);
      if (match && match[1]) {
        return parseInt(match[1], 10);
      }
    }

    return null;
  }

  /**
   * Parse PR review event to ConversationEvent
   * Links back to the originating issue if found in PR body
   */
  private parsePRReviewConversationEvent(
    payload: GitHubPullRequestReviewEventPayload
  ): ConversationEvent {
    const { pull_request, review, repository } = payload;
    const prLabels = (pull_request.labels || []).map((l: GitHubLabel) => l.name);

    // Try to link back to the originating issue
    const linkedIssueNumber = this.extractLinkedIssueNumber(pull_request.body);
    const externalId = linkedIssueNumber
      ? `${repository.full_name}#${linkedIssueNumber}`  // Route to issue conversation
      : `${repository.full_name}#${pull_request.number}`; // Fallback to PR

    return {
      type: 'pr_review',
      source: {
        platform: 'github',
        externalId,
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
   * Links back to the originating issue if found in PR body
   */
  private parsePRReviewCommentConversationEvent(
    payload: GitHubPullRequestReviewCommentEventPayload
  ): ConversationEvent {
    const { pull_request, comment, repository } = payload;
    const prLabels = (pull_request.labels || []).map((l: GitHubLabel) => l.name);

    // Try to link back to the originating issue
    const linkedIssueNumber = this.extractLinkedIssueNumber(pull_request.body);
    const externalId = linkedIssueNumber
      ? `${repository.full_name}#${linkedIssueNumber}`  // Route to issue conversation
      : `${repository.full_name}#${pull_request.number}`; // Fallback to PR

    return {
      type: 'pr_review_comment',
      source: {
        platform: 'github',
        externalId,
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
            startLine: comment.start_line || undefined,
            originalLine: comment.original_line || undefined,
            side: comment.side,
            body: comment.body,
            author: comment.user?.login || 'unknown',
            diffHunk: comment.diff_hunk,
            inReplyToId: comment.in_reply_to_id ? String(comment.in_reply_to_id) : undefined,
          },
        ],
      },
      timestamp: new Date(comment.created_at).toISOString(),
    };
  }

  /**
   * Parse plan approved event (PR labeled with plan-approved)
   */
  private parsePlanApprovedConversationEvent(
    payload: GitHubPullRequestEventPayload
  ): ConversationEvent {
    const { pull_request, repository, label } = payload;
    const prLabels = (pull_request.labels || []).map((l: GitHubLabel) => l.name);

    // Try to link back to the originating issue
    const linkedIssueNumber = this.extractLinkedIssueNumber(pull_request.body);
    const externalId = linkedIssueNumber
      ? `${repository.full_name}#${linkedIssueNumber}`  // Route to issue conversation
      : `${repository.full_name}#${pull_request.number}`; // Fallback to PR

    return {
      type: 'plan_approved',
      source: {
        platform: 'github',
        externalId,
        url: pull_request.html_url,
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
        action: 'labeled',
        label: {
          name: label?.name || GitHubIssuesTrigger.PLAN_APPROVED_LABEL,
        },
        prBranch: pull_request.head?.ref,
      },
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get unique conversation identifier from trigger event
   * Format: owner/repo#number
   *
   * For PR events, uses the linked issue number if available,
   * otherwise falls back to the PR number.
   */
  getConversationId(event: TriggerEvent): string {
    const repoFullName = event.triggerId.split('#')[0];

    // Prefer issue number (set for issue events and PR events linked to issues)
    const issueNumber = event.metadata.issueNumber as number | undefined;
    if (issueNumber) {
      return `${repoFullName}#${issueNumber}`;
    }

    // Fall back to PR number for PR events without linked issue
    const prNumber = event.metadata.prNumber as number | undefined;
    if (prNumber) {
      return `${repoFullName}#${prNumber}`;
    }

    // Last resort: extract from triggerId
    const match = event.triggerId.match(/#(\d+)/);
    return match ? `${repoFullName}#${match[1]}` : event.triggerId;
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
    _project?: ProjectConfig
  ): Promise<void> {
    // Use the existing addComment method
    await this.addComment(event, message);
  }
}
