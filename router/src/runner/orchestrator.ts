import { TriggerPlugin, TriggerEvent, FixStatus, AnalysisResult } from '../triggers/base';
import { findProjectById } from '../config/projects';
import { validateTools } from './tools';
import { buildInvestigationPrompt } from './prompts';
import { getRunner, RunnerPlugin } from './base';
import { getVCSPlugin } from '../vcs';
import { formatPRBody } from '../vcs/base';
import { GitHubVCS } from '../vcs/github';
import { getErrorMessage } from '../types/errors';
import type {
  ConversationEvent,
  RouteMode,
  RunnerConversationResult,
} from '../types/conversation';
import { getConversationService } from '../conversation';
import { getPlanManager } from '../conversation/plan-manager';
import { buildUserMessage } from '../conversation/prompts';
import { logger } from '../logger';

/**
 * Main orchestrator for the fix workflow
 * Coordinates: tools → prompt → runner → analysis → PR
 */
export async function orchestrateFix(
  trigger: TriggerPlugin,
  event: TriggerEvent
): Promise<FixStatus> {
  console.log(`[Orchestrator] Starting fix for ${event.triggerType}:${event.triggerId}`);

  try {
    // Get project configuration
    const project = await findProjectById(event.projectId);
    if (!project) {
      throw new Error(`Project not found: ${event.projectId}`);
    }

    console.log(`[Orchestrator] Project: ${project.id}`);

    // Get runner (default to 'claude-code' if not specified)
    const runnerId = project.runner?.type || 'claude-code';
    const runner = getRunner(runnerId);
    if (!runner) {
      throw new Error(`Runner plugin not found: ${runnerId}`);
    }

    console.log(`[Orchestrator] Using runner: ${runner.name} (${runner.id})`);

    // Pre-flight checks
    await performPreflightChecks(runner);

    // Generate tools
    const tools = await trigger.getTools(event);
    console.log(`[Orchestrator] Generated ${tools.length} tools`);

    // Validate tools
    const validation = validateTools(tools);
    if (!validation.valid) {
      console.error('[Orchestrator] Tool validation failed:', validation.errors);
      throw new Error('Tool validation failed');
    }

    // Build prompt
    const prompt = buildInvestigationPrompt(trigger, event, tools);
    console.log(`[Orchestrator] Built investigation prompt (${prompt.length} chars)`);

    // Run AI agent via runner plugin
    const result = await runner.run({
      repoUrl: project.repo,
      branch: project.branch,
      prompt,
      tools,
      timeoutMs: project.runner?.timeout || 600000, // 10 minutes default
      env: project.runner?.env,
      eventLabels: event.metadata?.tags || [],
      projectId: event.projectId,
    });

    // Handle failure
    if (!result.success) {
      await trigger.addComment(
        event,
        `⚠️ Auto-fix attempt failed:\n\`\`\`\n${result.error || result.output.slice(0, 500)}\n\`\`\``
      );

      return {
        fixed: false,
        reason: 'runner_execution_failed',
        analysis: undefined,
      };
    }

    // No analysis output
    const analysis = result.analysis;
    if (!analysis) {
      await trigger.addComment(
        event,
        '⚠️ Investigation completed but no analysis output found'
      );

      return {
        fixed: false,
        reason: 'no_analysis',
        analysis: undefined,
      };
    }

    // Log analysis
    console.log('[Orchestrator] Analysis:', {
      canAutoFix: analysis.canAutoFix,
      confidence: analysis.confidence,
      complexity: analysis.complexity,
    });

    // Low confidence or can't auto-fix - post analysis only
    if (!analysis.canAutoFix || analysis.confidence !== 'high') {
      await trigger.addComment(event, formatAnalysisComment(analysis));

      return {
        fixed: false,
        reason: analysis.reason || 'low_confidence',
        analysis,
      };
    }

    // No commit made despite analysis saying it's fixable
    if (!result.hasCommit || !result.branchName) {
      await trigger.addComment(
        event,
        '⚠️ Analysis indicated fix was possible but no commit was made'
      );

      return {
        fixed: false,
        reason: 'no_commit',
        analysis,
      };
    }

    // Success! Create PR using VCS plugin
    console.log(`[Orchestrator] Creating PR for branch ${result.branchName}`);

    // Get VCS plugin
    const vcs = getVCSPlugin(project.vcs.type);
    if (!vcs) {
      throw new Error(`VCS plugin not found: ${project.vcs.type}`);
    }

    let prUrl: string;
    let prNumber: number | undefined;

    try {
      // Create PR
      const triggerLink = trigger.getLink(event);
      const prBody = formatPRBody(analysis, triggerLink);

      const pr = await vcs.createPullRequest(
        project.vcs.owner,
        project.vcs.repo,
        result.branchName,
        project.branch,
        `fix: ${analysis.summary}`,
        prBody
      );

      prUrl = pr.htmlUrl;
      prNumber = pr.number;

      console.log(`[Orchestrator] PR created: ${prUrl}`);

      // Add labels if configured (GitHub specific)
      if (project.vcs.labels && project.vcs.labels.length > 0 && vcs instanceof GitHubVCS) {
        await vcs.addLabels(project.vcs.owner, project.vcs.repo, pr.number, project.vcs.labels);
      }

      // Request reviewers if configured (GitHub specific)
      if (project.vcs.reviewers && project.vcs.reviewers.length > 0 && vcs instanceof GitHubVCS) {
        await vcs.requestReviewers(project.vcs.owner, project.vcs.repo, pr.number, project.vcs.reviewers);
      }
    } catch (error) {
      console.error(`[Orchestrator] Failed to create PR:`, getErrorMessage(error));

      // Fall back to compare URL
      prUrl = vcs.getCompareUrl(
        project.vcs.owner,
        project.vcs.repo,
        project.branch,
        result.branchName
      );

      console.log(`[Orchestrator] Using compare URL: ${prUrl}`);
    }

    // Update trigger status
    await trigger.updateStatus(event, { fixed: true, analysis, prUrl });
    await trigger.addComment(
      event,
      `✅ Automated fix ${prNumber ? `submitted in #${prNumber}` : 'created'}!\n\n${formatAnalysisComment(analysis)}\n\n**Branch:** \`${result.branchName}\`\n**${prNumber ? 'Pull Request' : 'Compare'}:** ${prUrl}`
    );

    return {
      fixed: true,
      prUrl,
      analysis,
    };
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    console.error('[Orchestrator] Error:', errorMessage);

    try {
      await trigger.addComment(
        event,
        `❌ Auto-fix failed: ${errorMessage}`
      );
    } catch {
      // Ignore comment errors
    }

    return {
      fixed: false,
      reason: errorMessage,
      analysis: undefined,
    };
  }
}

/**
 * Perform pre-flight checks
 */
async function performPreflightChecks(runner: RunnerPlugin): Promise<void> {
  // Validate runner configuration
  const validation = await runner.validate();
  if (!validation.valid) {
    throw new Error(`Runner validation failed: ${validation.error}`);
  }

  // Check runner availability
  const available = await runner.isAvailable();
  if (!available) {
    throw new Error(`Runner ${runner.name} is not available`);
  }
}

/**
 * Format analysis as a comment
 */
function formatAnalysisComment(analysis: AnalysisResult): string {
  return `
## 🔍 Auto-Fix Analysis

**Summary:** ${analysis.summary}

**Root Cause:** ${analysis.rootCause}

**Can Auto-Fix:** ${analysis.canAutoFix ? 'Yes' : 'No'}
**Confidence:** ${analysis.confidence}
**Complexity:** ${analysis.complexity}

${analysis.reason ? `**Reason Not Fixed:** ${analysis.reason}\n` : ''}
${analysis.proposedFix ? `**Proposed Fix:** ${analysis.proposedFix}\n` : ''}

**Files Involved:**
${analysis.filesInvolved.map((f) => `- \`${f}\``).join('\n')}

---
*This analysis was generated automatically by AI Bug Fixer*
  `.trim();
}

// ========================================
// Conversation Orchestration
// ========================================

/**
 * Orchestrate a conversation job
 */
export async function orchestrateConversation(
  trigger: TriggerPlugin,
  conversationId: string,
  projectId: string,
  events: ConversationEvent[],
  routeMode: RouteMode,
  iteration: number
): Promise<RunnerConversationResult> {
  logger.info('Starting conversation orchestration', {
    conversationId,
    projectId,
    eventCount: events.length,
    routeMode,
    iteration,
  });

  // Get project configuration early so we can use it in error handling
  const project = await findProjectById(projectId);
  if (!project) {
    // Can't do much without a project - return error
    return {
      response: `Error: Project not found: ${projectId}`,
      action: { type: 'comment', body: `Project not found: ${projectId}` },
      complete: false,
    };
  }

  // Create triggerEvent early so it's available in catch block
  const triggerEvent: TriggerEvent = {
    triggerType: trigger.type,
    triggerId: conversationId,
    projectId,
    title: events[0]?.target.title || 'Conversation',
    description: events[0]?.target.body || '',
    metadata: {
      labels: events[0]?.target.labels,
      issueNumber: events[0]?.target.number,
      owner: project.vcs.owner,
      repo: project.vcs.repo,
    },
    raw: events,
  };

  try {

    // Get services
    const conversationService = getConversationService();
    const planManager = getPlanManager();

    // Get runner
    const runnerId = project.runner?.type || 'claude-code';
    const runner = getRunner(runnerId);
    if (!runner) {
      throw new Error(`Runner plugin not found: ${runnerId}`);
    }

    // Check if runner supports conversation mode
    if (!runner.supportsConversation || !runner.runConversation) {
      throw new Error(`Runner ${runnerId} does not support conversation mode`);
    }

    // Pre-flight checks
    await performPreflightChecks(runner);

    // Get conversation message history
    const conversation = await conversationService.getOrCreateConversation(
      trigger.type,
      conversationId,
      projectId,
      {}
    );
    const messageHistory = await conversationService.getMessageHistory(conversation.id);

    // Get existing plan if applicable
    let existingPlan = undefined;
    if (conversation.planRef) {
      const vcs = getVCSPlugin(project.vcs.type);
      if (vcs?.supportsPlanFiles && vcs.getPlanFile) {
        // Cast to any to avoid type mismatch between config/projects and db/repositories
        const planContent = await vcs.getPlanFile(project, conversation.planRef);
        if (planContent) {
          existingPlan = planManager.parsePlanFromMarkdown(planContent);
        }
      }
    }

    // Build user message from events
    const userMessage = buildUserMessage(events, existingPlan);

    // Add events as user message
    await conversationService.addMessage(
      conversation.id,
      'user',
      userMessage,
      events[0] ? {
        type: events[0].type,
        id: events[0].source.externalId,
        author: 'user',
      } : undefined
    );

    // Generate tools if trigger provides them
    const tools = await trigger.getTools(triggerEvent);

    // Run conversation
    const result = await runner.runConversation({
      repoUrl: project.repo,
      branch: project.branch,
      prompt: userMessage,
      tools,
      timeoutMs: project.runner?.timeout || 600000,
      env: project.runner?.env,
      projectId,
      conversationHistory: messageHistory,
      routeMode,
      iteration,
      existingPlan,
    });

    // Store assistant response
    await conversationService.addMessage(
      conversation.id,
      'assistant',
      result.response
    );

    // Handle result action
    await handleConversationAction(
      trigger,
      triggerEvent,
      project,
      conversation,
      result,
      conversationService,
      planManager
    );

    logger.info('Conversation orchestration completed', {
      conversationId,
      actionType: result.action.type,
      complete: result.complete,
    });

    return result;
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    logger.error('Conversation orchestration failed', {
      conversationId,
      error: errorMessage,
    });

    // Post error feedback using pre-created triggerEvent (has owner/repo)
    if (trigger.postFeedback) {
      await trigger.postFeedback(
        triggerEvent,
        `⚠️ I encountered an error: ${errorMessage}`
      ).catch(() => {});
    }

    return {
      response: `Error: ${errorMessage}`,
      action: { type: 'comment', body: `An error occurred: ${errorMessage}` },
      complete: false,
    };
  }
}

/**
 * Handle the action from conversation result
 */
async function handleConversationAction(
  trigger: TriggerPlugin,
  triggerEvent: TriggerEvent,
  project: NonNullable<Awaited<ReturnType<typeof findProjectById>>>,
  conversation: { id: string; planRef?: string | null },
  result: RunnerConversationResult,
  conversationService: ReturnType<typeof getConversationService>,
  planManager: ReturnType<typeof getPlanManager>
): Promise<void> {
  const action = result.action;

  switch (action.type) {
    case 'create_plan': {
      // Create plan file via VCS
      const vcs = getVCSPlugin(project.vcs.type);
      if (!vcs?.supportsPlanFiles || !vcs.createPlanFile) {
        throw new Error(`VCS ${project.vcs.type} does not support plan files`);
      }

      const planPath = planManager.getPlanPath(conversation.id);
      const planContent = planManager.renderPlanToMarkdown(action.plan);

      const planResult = await vcs.createPlanFile(
        project,
        planContent,
        planPath,
        triggerEvent.metadata.issueNumber as number | undefined
      );

      // Update conversation with plan reference
      await conversationService.updateStatus(conversation.id, {
        planRef: planResult.planRef,
        planVersion: 1,
        status: 'reviewing',
      });

      // Post feedback with plan link
      if (trigger.postFeedback) {
        const planUrl = planResult.url || planResult.planRef;
        await trigger.postFeedback(
          triggerEvent,
          `📋 I've created an implementation plan for review.\n\n**Plan:** ${planUrl}\n\nPlease review and provide feedback. I'll iterate based on your comments.`
        );
      }
      break;
    }

    case 'update_plan': {
      // Update existing plan
      const vcs = getVCSPlugin(project.vcs.type);
      if (!vcs?.supportsPlanFiles || !vcs.updatePlanFile || !conversation.planRef) {
        throw new Error('Cannot update plan: VCS does not support plan files or no plan exists');
      }

      await vcs.updatePlanFile(project, conversation.planRef, action.content);

      // Update plan version
      await conversationService.updateStatus(conversation.id, {
        planVersion: action.planVersion,
      });

      // Post feedback
      if (trigger.postFeedback) {
        await trigger.postFeedback(
          triggerEvent,
          `📝 I've updated the plan based on your feedback. Please review the changes.`
        );
      }
      break;
    }

    case 'execute': {
      // Mark as executing
      await conversationService.updateStatus(conversation.id, {
        status: 'executing',
      });

      // Post feedback
      if (trigger.postFeedback) {
        await trigger.postFeedback(
          triggerEvent,
          `🚀 Executing the approved plan: ${action.description}`
        );
      }
      break;
    }

    case 'comment': {
      // Just post a comment
      if (trigger.postFeedback) {
        await trigger.postFeedback(triggerEvent, action.body);
      }
      break;
    }

    case 'request_info': {
      // Post questions
      if (trigger.postFeedback) {
        const questionList = action.questions
          .map((q, i) => `${i + 1}. ${q}`)
          .join('\n');
        await trigger.postFeedback(
          triggerEvent,
          `❓ I need some clarification before proceeding:\n\n${questionList}`
        );
      }
      break;
    }
  }

  // Update conversation status based on completion
  if (result.complete) {
    await conversationService.updateStatus(conversation.id, {
      status: 'complete',
    });
  }
}
