import { TriggerPlugin, TriggerEvent, FixStatus, AnalysisResult } from '../triggers/base';
import { findProjectById, ProjectConfig } from '../config/projects';
import { validateTools } from './tools';
import { buildInvestigationPrompt } from './prompts';
import { getRunner, RunnerPlugin } from './base';
import { getVCSForProject } from '../vcs';
import { formatPRBody } from '../vcs/base';
import { GitHubVCS } from '../vcs/github';
import { findPRProvider, PRResult } from '../pr';
import { getErrorMessage } from '../types/errors';
import type {
  ConversationEvent,
  RouteMode,
  RunnerConversationResult,
  PlanFile,
} from '../types/conversation';
import { getConversationService } from '../conversation';
import { getPlanManager } from '../conversation/plan-manager';
import { buildUserMessage } from '../conversation/prompts';
import { logger } from '../logger';
// Types for future escalation handling (currently used for documentation)
// import type { EscalationRequest, InvestigationContext } from './bug-config';

/**
 * Legacy orchestrator for triggers that don't support conversation mode.
 * New triggers should implement conversation support instead.
 *
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

    // Success! Create PR using PR provider
    console.log(`[Orchestrator] Creating PR for branch ${result.branchName}`);

    // Determine target repo for PR (may route to secondary repo)
    const targetProject = await getTargetProjectForPR(project, analysis);
    const isSecondaryRepo = targetProject.repoFullName !== project.repoFullName;

    if (isSecondaryRepo) {
      console.log(`[Orchestrator] Routing PR to secondary repo: ${targetProject.repoFullName}`);
    }

    // Use PR provider for deterministic PR creation
    const prResult = await createPullRequest(
      targetProject,
      result.branchName,
      `fix: ${analysis.summary}`,
      formatPRBody(analysis, trigger.getLink(event))
    );

    const prUrl = prResult.prUrl || prResult.compareUrl || '';
    const prNumber = prResult.prNumber;

    if (prResult.success) {
      console.log(`[Orchestrator] PR created: ${prUrl}`);

      // Add labels and reviewers if configured (GitHub specific)
      const vcs = await getVCSForProject(targetProject.vcs.type, targetProject.id);
      if (vcs instanceof GitHubVCS && prNumber) {
        if (targetProject.vcs.labels && targetProject.vcs.labels.length > 0) {
          await vcs.addLabels(targetProject.vcs.owner, targetProject.vcs.repo, prNumber, targetProject.vcs.labels);
        }
        if (targetProject.vcs.reviewers && targetProject.vcs.reviewers.length > 0) {
          await vcs.requestReviewers(targetProject.vcs.owner, targetProject.vcs.repo, prNumber, targetProject.vcs.reviewers);
        }
      }
    } else {
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
 * Create a pull request using the PR provider system
 * Falls back to compare URL if PR creation fails
 */
async function createPullRequest(
  project: ProjectConfig,
  branchName: string,
  title: string,
  body: string
): Promise<PRResult> {
  // Find a PR provider that can handle this project
  const provider = await findPRProvider(project);

  if (!provider) {
    // No provider available - return compare URL fallback
    // We need to construct the compare URL ourselves
    const baseUrl = project.vcs.type === 'github'
      ? `https://github.com/${project.vcs.owner}/${project.vcs.repo}/compare/${project.branch}...${branchName}`
      : `${project.repoFullName}/compare/${project.branch}...${branchName}`;

    return {
      success: false,
      compareUrl: baseUrl,
      error: 'No PR provider available for this project',
    };
  }

  // Use the provider to create the PR
  const result = await provider.createPullRequest({
    projectId: project.id,
    owner: project.vcs.owner,
    repo: project.vcs.repo,
    head: branchName,
    base: project.branch,
    title,
    body,
  });

  // If PR creation failed but we have a provider, get the compare URL from it
  if (!result.success && !result.compareUrl) {
    result.compareUrl = provider.getCompareUrl({
      owner: project.vcs.owner,
      repo: project.vcs.repo,
      base: project.branch,
      head: branchName,
    });
  }

  return result;
}

/**
 * Get the target project for creating a PR
 * Routes to secondary repo if analysis.targetRepo specifies one
 *
 * @param project - Original project config
 * @param analysis - Analysis result with optional targetRepo
 * @returns Project config with potentially modified VCS settings
 */
async function getTargetProjectForPR(
  project: ProjectConfig,
  analysis: AnalysisResult | undefined
): Promise<ProjectConfig> {
  // Use main project if no targetRepo specified or it's 'main'
  if (!analysis?.targetRepo || analysis.targetRepo === 'main') {
    return project;
  }

  // targetRepo is "owner/repo" format
  const targetRepoFullName = analysis.targetRepo;
  const [owner, repo] = targetRepoFullName.split('/');

  if (!owner || !repo) {
    logger.warn('Invalid targetRepo format, using main project', {
      targetRepo: analysis.targetRepo,
    });
    return project;
  }

  // Check if this repo has its own project config
  const targetProject = await findProjectById(targetRepoFullName);

  if (targetProject) {
    // Use target project's config (it owns that repo)
    logger.info('Routing PR to secondary repo with existing project', {
      targetRepo: targetRepoFullName,
      projectId: targetProject.id,
    });
    return targetProject;
  }

  // No project for this repo - create PR using same VCS type but different owner/repo
  logger.info('Routing PR to secondary repo (no existing project)', {
    targetRepo: targetRepoFullName,
    mainProject: project.id,
  });

  return {
    ...project,
    repoFullName: targetRepoFullName,
    vcs: { ...project.vcs, owner, repo },
  };
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
      const vcs = await getVCSForProject(project.vcs.type, project.id);
      if (vcs?.supportsPlanFiles && vcs.getPlanFile) {
        const planContent = await vcs.getPlanFile(project, conversation.planRef);
        if (planContent) {
          existingPlan = planManager.parsePlanFromMarkdown(planContent);
        }
      }
    }

    // Determine existing PR info (from conversation or from event target)
    // This is used to push updates to an existing PR instead of creating a new one
    let existingPrNumber = conversation.prNumber ?? undefined;
    let existingPrBranch: string | undefined;

    // If we don't have PR info in conversation, check if we're responding to a PR event
    if (!existingPrNumber && events[0]?.target.type === 'pull_request') {
      const targetNumber = events[0].target.number;
      existingPrNumber = typeof targetNumber === 'string' ? parseInt(targetNumber, 10) : targetNumber;
    }

    // If we have a PR, try to get the branch name
    if (existingPrNumber && !existingPrBranch) {
      // Try to get branch from VCS
      const vcs = await getVCSForProject(project.vcs.type, project.repoFullName);
      if (vcs instanceof GitHubVCS) {
        const prInfo = await vcs.getPullRequestInfo(
          project.vcs.owner,
          project.vcs.repo,
          existingPrNumber
        );
        if (prInfo) {
          existingPrBranch = prInfo.head.ref;
        }
      }
    }

    // Check for plan approval event - triggers execution
    const planApprovedEvent = events.find(e => e.type === 'plan_approved');
    if (planApprovedEvent && existingPlan) {
      logger.info('Plan approved - triggering execution', {
        conversationId,
        planRef: conversation.planRef,
        prNumber: existingPrNumber,
      });

      // Update plan status to approved
      existingPlan.metadata.status = 'approved';

      // Post acknowledgment
      if (trigger.postFeedback) {
        await trigger.postFeedback(
          triggerEvent,
          `🚀 Plan approved! Starting implementation...\n\nI'll execute the approved plan and push the changes to this PR.`
        );
      }
    }

    // Check for escalation event - triggers re-run with different agent
    const escalationEvent = events.find(e => e.type === 'escalation_requested');
    if (escalationEvent) {
      const escalationType = escalationEvent.payload.escalationType;
      logger.info('Escalation requested', {
        conversationId,
        escalationType,
        prNumber: existingPrNumber,
      });

      // Post acknowledgment
      if (trigger.postFeedback) {
        const agentName = escalationType === 'complex' ? 'complex (opus)'
          : escalationType === 'investigate' ? 'investigate (sonnet)'
          : 'triage (haiku)';
        await trigger.postFeedback(
          triggerEvent,
          `🔄 Escalation requested. Re-running with ${agentName} agent...`
        );
      }

      // Store escalation info in conversation metadata for runner to use
      await conversationService.updateStatus(conversation.id, {
        // Store escalation type so runner can pick the right agent
        status: 'executing',
      });
    }

    // Check if PR review events have meaningful content
    // If we only have PR review events with no body/comments, ask for details
    // Skip this check for plan_approved events
    const hasMeaningfulContent = planApprovedEvent || checkEventsHaveContent(events);
    if (!hasMeaningfulContent) {
      logger.info('PR review events have no meaningful content, asking for details', {
        conversationId,
        eventCount: events.length,
        eventTypes: events.map(e => e.type),
      });

      // Post feedback asking for details
      if (trigger.postFeedback) {
        // Determine the review state to give appropriate response
        const reviewEvent = events.find(e => e.type === 'pr_review');
        const reviewState = reviewEvent?.payload?.review?.state?.toLowerCase();

        let message: string;
        if (reviewState === 'approved') {
          message = `Thanks for the approval! If you have any specific feedback or changes you'd like me to make, please add a comment.`;
        } else if (reviewState === 'changes_requested') {
          message = `I see you've requested changes. Could you add some comments explaining what you'd like me to change? I'll update the plan once I understand your feedback.`;
        } else {
          message = `I received your review but couldn't find specific feedback. Could you add a comment with details about what you'd like me to change?`;
        }

        await trigger.postFeedback(triggerEvent, message);
      }

      return {
        response: 'Waiting for user feedback',
        action: { type: 'comment', body: 'Waiting for detailed feedback' },
        complete: false,
      };
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
      branch: existingPrBranch || project.branch, // Use PR branch if updating existing PR
      prompt: userMessage,
      tools,
      timeoutMs: project.runner?.timeout || 600000,
      env: project.runner?.env,
      projectId,
      conversationHistory: messageHistory,
      routeMode,
      iteration,
      issueNumber: triggerEvent.metadata.issueNumber as number | string | undefined,
      existingPlan,
      existingPrNumber,
      existingPrBranch,
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
      { ...conversation, prNumber: existingPrNumber, prBranch: existingPrBranch },
      result,
      existingPlan,
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
  conversation: { id: string; planRef?: string | null; prNumber?: number; prBranch?: string },
  result: RunnerConversationResult,
  existingPlan: PlanFile | undefined,
  conversationService: ReturnType<typeof getConversationService>,
  planManager: ReturnType<typeof getPlanManager>
): Promise<void> {
  const action = result.action;

  switch (action.type) {
    case 'create_plan': {
      const vcs = await getVCSForProject(project.vcs.type, project.id);
      if (!vcs?.supportsPlanFiles) {
        throw new Error(`VCS ${project.vcs.type} does not support plan files or is not configured`);
      }

      // Validate action.plan before rendering
      if (!action.plan) {
        logger.warn('create_plan action has no plan content', {
          conversationId: conversation.id,
          prNumber: conversation.prNumber,
        });
        // Post feedback explaining the issue
        if (trigger.postFeedback) {
          await trigger.postFeedback(
            triggerEvent,
            `I received your feedback but couldn't generate an updated plan. Could you provide more details about what you'd like me to change?`
          );
        }
        break;
      }

      // Set the issue number on the plan before rendering
      // The runner may not know the issue number, so we set it from the trigger event
      const issueNumber = (triggerEvent.metadata.issueNumber as number | string | undefined)
        || (triggerEvent.metadata.prNumber as number | string | undefined)
        || conversation.id;
      action.plan.metadata.issue = issueNumber;

      const planPath = planManager.getPlanPath(conversation.id);
      const planContent = planManager.renderPlanToMarkdown(action.plan);

      // Validate rendered plan content
      if (!planContent) {
        logger.warn('create_plan rendered to empty content', {
          conversationId: conversation.id,
          prNumber: conversation.prNumber,
        });
        if (trigger.postFeedback) {
          await trigger.postFeedback(
            triggerEvent,
            `I received your feedback but couldn't generate an updated plan. Could you provide more details about what you'd like me to change?`
          );
        }
        break;
      }

      // Check if we're updating an existing PR (respond to PR review with new plan)
      // In this case, update the existing plan file instead of creating a new PR
      // We need either: stored planRef, or existing PR branch to find the plan file
      let effectivePlanRef = conversation.planRef;

      // If we have an existing PR branch but no planRef, try to find the plan file
      if (conversation.prNumber && conversation.prBranch && !effectivePlanRef && vcs.findPlanFile) {
        logger.info('Looking for existing plan file on PR branch', {
          conversationId: conversation.id,
          prNumber: conversation.prNumber,
          prBranch: conversation.prBranch,
        });

        const foundPlanRef = await vcs.findPlanFile(project, conversation.prBranch);
        if (foundPlanRef) {
          effectivePlanRef = foundPlanRef;
          logger.info('Found existing plan file', { planRef: foundPlanRef });
        }
      }

      if (conversation.prNumber && effectivePlanRef && vcs.updatePlanFile) {
        logger.info('Updating existing plan on PR branch', {
          conversationId: conversation.id,
          prNumber: conversation.prNumber,
          planRef: effectivePlanRef,
        });

        await vcs.updatePlanFile(project, effectivePlanRef, planContent);

        // Update conversation with the plan ref if we found it
        if (!conversation.planRef && effectivePlanRef) {
          await conversationService.updateStatus(conversation.id, {
            planRef: effectivePlanRef,
          });
        }

        // Post feedback about the update
        if (trigger.postFeedback) {
          await trigger.postFeedback(
            triggerEvent,
            `📝 I've updated the plan based on your feedback. Please review the changes.`
          );
        }
        break;
      }

      // Creating a new plan/PR
      if (!vcs.createPlanFile) {
        throw new Error(`VCS ${project.vcs.type} does not support creating plan files`);
      }

      const planResult = await vcs.createPlanFile(
        project,
        planContent,
        planPath,
        triggerEvent.metadata.issueNumber as number | undefined
      );

      // Update conversation with plan reference and PR info if available
      const updateData: Parameters<typeof conversationService.updateStatus>[1] = {
        planRef: planResult.planRef,
        planVersion: 1,
        status: 'reviewing',
      };

      // If the plan was created as a PR, save PR info to conversation
      if (planResult.prNumber) {
        updateData.prNumber = planResult.prNumber;
        updateData.prUrl = planResult.url || undefined;
      }

      await conversationService.updateStatus(conversation.id, updateData);

      // Post feedback with plan link
      if (trigger.postFeedback) {
        const planUrl = planResult.url || planResult.planRef;

        // If a PR was created, post redirect notice on the issue
        if (planResult.prNumber) {
          await trigger.postFeedback(
            triggerEvent,
            `📋 I've created a pull request with an implementation plan.\n\n**PR:** #${planResult.prNumber}\n\n` +
            `Please review the plan and provide feedback. I'll iterate based on your comments.\n\n` +
            `**To approve the plan and start implementation**, add the \`plan-approved\` label to the PR.`
          );
        } else {
          await trigger.postFeedback(
            triggerEvent,
            `📋 I've created an implementation plan for review.\n\n**Plan:** ${planUrl}\n\n` +
            `Please review and provide feedback. I'll iterate based on your comments.\n\n` +
            `**To approve the plan and start implementation**, add the \`plan-approved\` label.`
          );
        }
      }
      break;
    }

    case 'update_plan': {
      // Update existing plan
      const vcs = await getVCSForProject(project.vcs.type, project.id);
      if (!vcs?.supportsPlanFiles || !vcs.updatePlanFile || !conversation.planRef) {
        throw new Error('Cannot update plan: VCS does not support plan files or no plan exists');
      }

      // Validate action content before updating
      if (!action.content) {
        logger.warn('update_plan action has no content', {
          conversationId: conversation.id,
          planRef: conversation.planRef,
        });
        // Post feedback explaining the issue instead of throwing
        if (trigger.postFeedback) {
          await trigger.postFeedback(
            triggerEvent,
            `I received your feedback but couldn't generate an updated plan. Could you provide more details about what you'd like me to change?`
          );
        }
        break;
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

    case 'create_pr': {
      // Direct PR creation (for auto_execute mode or approved plans)
      // OR: Updates to existing PR (when responding to PR review)
      const { analysis, branchName } = action;

      // Check if we're updating an existing PR rather than creating a new one
      if (conversation.prNumber) {
        // Just pushed updates to existing PR branch - no need to create new PR
        logger.info('Updates pushed to existing PR branch', {
          conversationId: conversation.id,
          prNumber: conversation.prNumber,
          branchName,
        });

        // Check if this was a plan execution (plan was approved)
        const wasApprovedPlanExecution = existingPlan?.metadata?.status === 'approved';

        if (wasApprovedPlanExecution) {
          // Clean up the plan file after successful execution
          const vcs = await getVCSForProject(project.vcs.type, project.id);
          if (conversation.planRef && vcs instanceof GitHubVCS) {
            try {
              // Delete just the plan file, not the branch (the PR is still open)
              await vcs.removePlanFileOnly(project, conversation.planRef);
              logger.info('Cleaned up plan file after execution', {
                conversationId: conversation.id,
                planRef: conversation.planRef,
              });
            } catch (cleanupError) {
              logger.warn('Failed to clean up plan file', {
                conversationId: conversation.id,
                planRef: conversation.planRef,
                error: getErrorMessage(cleanupError),
              });
            }
          }

          // Post completion message
          if (trigger.postFeedback) {
            const comment = `✅ Implementation complete!\n\n**Summary:** ${analysis.summary}\n\n**Files Modified:**\n${analysis.filesInvolved.map(f => `- \`${f}\``).join('\n')}\n\nThe plan has been executed and the code changes are ready for review. Please review the changes and merge when ready.`;
            await trigger.postFeedback(triggerEvent, comment);
          }

          // Mark conversation as complete
          await conversationService.updateStatus(conversation.id, {
            status: 'complete',
          });
        } else {
          // Regular update - not plan execution
          if (trigger.postFeedback) {
            const comment = `✅ I've pushed updates to address your feedback.\n\n**Summary:** ${analysis.summary}\n\n**Files Modified:**\n${analysis.filesInvolved.map(f => `- \`${f}\``).join('\n')}`;
            await trigger.postFeedback(triggerEvent, comment);
          }
        }

        // Don't mark as complete for regular updates - conversation continues on PR
        break;
      }

      // Creating a new PR
      logger.info('Creating PR from conversation', {
        conversationId: conversation.id,
        branchName,
        confidence: analysis.confidence,
      });

      // Use PR provider for deterministic PR creation
      const triggerLink = trigger.getLink(triggerEvent);
      const prResult = await createPullRequest(
        project,
        branchName,
        `fix: ${analysis.summary}`,
        formatPRBody(analysis, triggerLink)
      );

      const prUrl = prResult.prUrl || prResult.compareUrl || '';
      const prNumber = prResult.prNumber;

      if (prResult.success) {
        logger.info('PR created from conversation', {
          conversationId: conversation.id,
          prUrl,
          prNumber,
        });

        // Add labels and reviewers if configured (GitHub specific)
        const vcs = await getVCSForProject(project.vcs.type, project.id);
        if (vcs instanceof GitHubVCS && prNumber) {
          if (project.vcs.labels && project.vcs.labels.length > 0) {
            await vcs.addLabels(project.vcs.owner, project.vcs.repo, prNumber, project.vcs.labels);
          }
          if (project.vcs.reviewers && project.vcs.reviewers.length > 0) {
            await vcs.requestReviewers(project.vcs.owner, project.vcs.repo, prNumber, project.vcs.reviewers);
          }
        }
      } else {
        logger.warn('PR creation failed, using compare URL', {
          conversationId: conversation.id,
          compareUrl: prUrl,
          error: prResult.error,
        });
      }

      // Update conversation with PR info
      await conversationService.updateStatus(conversation.id, {
        status: 'complete',
        prNumber,
        prUrl,
      });

      // Post success message
      if (trigger.postFeedback) {
        const comment = prNumber
          ? `✅ Fix submitted in #${prNumber}!\n\n**Summary:** ${analysis.summary}\n\n**Root Cause:** ${analysis.rootCause}\n\n**Files Modified:**\n${analysis.filesInvolved.map(f => `- \`${f}\``).join('\n')}\n\n**Pull Request:** ${prUrl}`
          : `✅ Fix created!\n\n**Summary:** ${analysis.summary}\n\n**Compare:** ${prUrl}`;

        await trigger.postFeedback(triggerEvent, comment);
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

/**
 * Check if events have meaningful content worth processing
 *
 * For PR review events, checks if there's actually feedback to process.
 * Empty approvals or change requests without comments should not trigger
 * expensive runner operations.
 */
function checkEventsHaveContent(events: ConversationEvent[]): boolean {
  // If there are no events, nothing to process
  if (events.length === 0) {
    return false;
  }

  // Check if any event has meaningful content
  for (const event of events) {
    switch (event.type) {
      case 'issue_opened':
        // Issue always has content (title + body)
        return true;

      case 'issue_comment':
      case 'pr_comment':
        // Comments have content if body is non-empty
        if (event.payload.comment?.body?.trim()) {
          return true;
        }
        break;

      case 'pr_review':
        // Review has content if:
        // 1. Review body is non-empty, OR
        // 2. There are inline comments
        if (event.payload.review?.body?.trim()) {
          return true;
        }
        if (event.payload.reviewComments && event.payload.reviewComments.length > 0) {
          return true;
        }
        break;

      case 'pr_review_comment':
        // Review comment has content if body is non-empty
        if (event.payload.comment?.body?.trim()) {
          return true;
        }
        if (event.payload.reviewComments && event.payload.reviewComments.length > 0) {
          // Check if any review comment has content
          for (const comment of event.payload.reviewComments) {
            if (comment.body?.trim()) {
              return true;
            }
          }
        }
        break;

      case 'issue_labeled':
        // Labels are meaningful signals
        return true;

      case 'escalation_requested':
        // Escalation events are always meaningful - they trigger agent re-run
        return true;

      default:
        // Unknown event types - assume they have content
        return true;
    }
  }

  // None of the events had meaningful content
  return false;
}
