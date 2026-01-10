import { SourcePlugin, SourceEvent, FixStatus } from '../sources/base';
import { findProjectById } from '../config/projects';
import { generateAndMountTools, generateToolsReadme, validateTools } from './tools';
import { buildInvestigationPrompt } from './prompts';
import { runClaudeInContainer, isDockerAvailable, isClaudeRunnerImageAvailable } from './claude';
import { getVCSPlugin } from '../vcs';
import { formatPRBody } from '../vcs/base';
import { GitHubVCS } from '../vcs/github';

/**
 * Main orchestrator for the fix workflow
 * Coordinates: tools → prompt → Claude → analysis → PR
 */
export async function orchestrateFix(
  source: SourcePlugin,
  event: SourceEvent
): Promise<FixStatus> {
  console.log(`[Orchestrator] Starting fix for ${event.sourceType}:${event.sourceId}`);

  try {
    // Get project configuration
    const project = findProjectById(event.projectId);
    if (!project) {
      throw new Error(`Project not found: ${event.projectId}`);
    }

    console.log(`[Orchestrator] Project: ${project.id}`);

    // Pre-flight checks
    await performPreflightChecks();

    // Generate tools
    const tools = source.getTools(event);
    console.log(`[Orchestrator] Generated ${tools.length} tools`);

    // Validate tools
    const validation = validateTools(tools);
    if (!validation.valid) {
      console.error('[Orchestrator] Tool validation failed:', validation.errors);
      throw new Error('Tool validation failed');
    }

    // Build prompt
    const prompt = buildInvestigationPrompt(source, event, tools);
    console.log(`[Orchestrator] Built investigation prompt (${prompt.length} chars)`);

    // Run Claude
    const result = await runClaudeInContainer({
      repoUrl: project.repo,
      branch: project.branch,
      prompt,
      timeoutMs: 600000, // 10 minutes
    });

    // Handle failure
    if (!result.success) {
      await source.addComment(
        event,
        `⚠️ Auto-fix attempt failed:\n\`\`\`\n${result.error || result.output.slice(0, 500)}\n\`\`\``
      );

      return {
        fixed: false,
        reason: 'claude_execution_failed',
        analysis: undefined,
      };
    }

    // No analysis output
    const analysis = result.analysis;
    if (!analysis) {
      await source.addComment(
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
      await source.addComment(event, formatAnalysisComment(analysis));

      return {
        fixed: false,
        reason: analysis.reason || 'low_confidence',
        analysis,
      };
    }

    // No commit made despite analysis saying it's fixable
    if (!result.hasCommit || !result.branchName) {
      await source.addComment(
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
      const sourceLink = source.getLink(event);
      const prBody = formatPRBody(analysis, sourceLink);

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

    // Update source status
    await source.updateStatus(event, { fixed: true, analysis, prUrl });
    await source.addComment(
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
      await source.addComment(
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
async function performPreflightChecks(): Promise<void> {
  // Check Docker is available
  const dockerAvailable = await isDockerAvailable();
  if (!dockerAvailable) {
    throw new Error('Docker is not available');
  }

  // Check claude-runner image exists
  const imageAvailable = await isClaudeRunnerImageAvailable();
  if (!imageAvailable) {
    throw new Error('claude-runner:latest image not found. Run: docker compose --profile build-only build');
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
