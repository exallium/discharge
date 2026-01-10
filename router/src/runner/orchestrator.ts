import { TriggerPlugin, TriggerEvent, FixStatus } from '../triggers/base';
import { findProjectById } from '../config/projects';
import { generateAndMountTools, generateToolsReadme, validateTools } from './tools';
import { buildInvestigationPrompt } from './prompts';
import { getRunner, RunnerPlugin } from './base';
import { getVCSPlugin } from '../vcs';
import { formatPRBody } from '../vcs/base';
import { GitHubVCS } from '../vcs/github';

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
    const project = findProjectById(event.projectId);
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
    const tools = trigger.getTools(event);
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
    } catch (error: any) {
      console.error(`[Orchestrator] Failed to create PR:`, error.message);

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
  } catch (error: any) {
    console.error('[Orchestrator] Error:', error);

    try {
      await trigger.addComment(
        event,
        `❌ Auto-fix failed: ${error.message}`
      );
    } catch {
      // Ignore comment errors
    }

    return {
      fixed: false,
      reason: error.message,
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
function formatAnalysisComment(analysis: any): string {
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
${analysis.filesInvolved.map((f: string) => `- \`${f}\``).join('\n')}

---
*This analysis was generated automatically by Claude Agent*
  `.trim();
}
