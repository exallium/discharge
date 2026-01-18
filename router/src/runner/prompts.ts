import { TriggerPlugin, TriggerEvent, Tool } from '../triggers/base';
import {
  AiBugsConfig,
  ResolvedRule,
  InvestigationContext,
  getAvailableAgents,
} from './bug-config';

/**
 * Build the secondary repos section for prompts
 * Informs the AI about available secondary repos for cross-referencing
 */
export function buildSecondaryReposSection(
  mainRepoFullName: string,
  secondaryRepos: string[]
): string {
  if (!secondaryRepos || secondaryRepos.length === 0) {
    return '';
  }

  const secondaryList = secondaryRepos
    .map(repo => {
      const repoName = repo.split('/')[1];
      return `- \`${repo}\` at \`/workspace-secondary/${repoName}\``;
    })
    .join('\n');

  return `
## Available Repositories

**Main Repository** (at /workspace):
\`${mainRepoFullName}\`

**Secondary Repositories** (read-only reference):
${secondaryList}

## Submitting Fixes to Secondary Repos

If the fix should be applied to a secondary repository instead of the main repo,
set \`targetRepo\` in your analysis.json:

\`\`\`json
{
  "targetRepo": "owner/repo-name",
  ...
}
\`\`\`

Omit \`targetRepo\` or set to \`"main"\` for fixes in the main repository.
`;
}

/**
 * Build a generic investigation prompt for Claude
 *
 * @param trigger - Trigger plugin
 * @param event - Normalized event
 * @param tools - Tools available for investigation
 * @returns Prompt string
 */
export function buildInvestigationPrompt(
  trigger: TriggerPlugin,
  event: TriggerEvent,
  tools: Tool[]
): string {
  const toolsSection = tools.length > 0
    ? `## Available Tools

You have the following tools available to investigate this issue. All tools are executable bash scripts in your PATH:

${tools.map(t => `- \`${t.name}\` - ${t.description}`).join('\n')}

Run these tools to gather information before making any changes.
`
    : '';

  const context = trigger.getPromptContext(event);

  return `
You are an automated bug fixer investigating a ${event.triggerType} issue.

## Issue Details

${context}

${toolsSection}

## Investigation Process

1. **Gather Information**: Use the available tools to fully understand the bug
2. **Explore Codebase**: Search for relevant files and understand the context
3. **Identify Root Cause**: Determine what's actually causing the issue
4. **Assess Complexity**: Can this be fixed with high confidence?

## Decision Criteria

**DO auto-fix if:**
- Clear, isolated bug with obvious fix
- Type errors, null checks, off-by-one errors
- Missing error handling
- Simple logic errors
- Test failures with clear assertions
- You have high confidence the fix is correct

**DON'T auto-fix if:**
- Requires architectural changes
- Involves security-sensitive code (auth, crypto, permissions)
- Needs domain expertise to understand business logic
- Could have unintended side effects
- Requires coordination with other systems
- You're not confident in the fix
- The issue is ambiguous or poorly described

## Output Requirements

After your investigation, you MUST create a file at \`.claude/analysis.json\` with this exact structure:

\`\`\`json
{
  "canAutoFix": true | false,
  "confidence": "high" | "medium" | "low",
  "summary": "One-line description of the bug",
  "rootCause": "What is causing this bug",
  "proposedFix": "How you will fix it (if canAutoFix)",
  "reason": "Why it cannot be auto-fixed (if !canAutoFix)",
  "filesInvolved": ["src/path/to/file.ts"],
  "complexity": "trivial" | "simple" | "moderate" | "complex"
}
\`\`\`

## If canAutoFix is true AND confidence is "high":

1. Implement the fix with minimal, focused changes
2. Run existing tests if available to verify the fix
3. Add a test for the bug if straightforward
4. Commit your changes with message: "fix: <summary>"

## If canAutoFix is false OR confidence is not "high":

Stop after creating analysis.json. Do NOT make any code changes.

## Important Notes

- Focus on the specific issue described
- Don't make unrelated changes or "improvements"
- Don't add features beyond fixing the bug
- Don't refactor code unless necessary for the fix
- Be conservative: when in doubt, don't auto-fix

---

Begin your investigation now.
`.trim();
}

/**
 * Build a simple prompt for testing without tools
 */
export function buildSimplePrompt(event: TriggerEvent): string {
  return `
Investigate this issue:

**Title:** ${event.title}
**Description:** ${event.description}

Create a file at \`.claude/analysis.json\` with your findings.
`.trim();
}

// ============================================================================
// Agent-Based Prompts
// ============================================================================

/**
 * Build the triage prompt for agent selection
 *
 * @param trigger - Trigger plugin
 * @param event - Normalized event
 * @param config - AiBugsConfig (v2)
 * @returns Prompt string for triage agent
 */
export function buildTriagePrompt(
  trigger: TriggerPlugin,
  event: TriggerEvent,
  config: AiBugsConfig | undefined
): string {
  const context = trigger.getPromptContext(event);
  const availableAgents = getAvailableAgents(config);

  // Build agent list for triage to consider
  const agentList = availableAgents
    .filter((a) => a.name !== 'triage') // Don't include triage itself
    .map((a) => `- **${a.name}** (${a.model}): ${a.description}`)
    .join('\n');

  return `
You are a triage agent analyzing an incoming issue to determine how to handle it.

## Issue Details

${context}

## Available Agents

${agentList}

## Your Task

Analyze this issue and determine:

1. **Is it actionable?** Can this be addressed by an automated system?
   - If NO: Explain why (duplicate, needs-info, out-of-scope, wont-fix)

2. **Is it trivial?** Is this an obvious one-line fix that requires no investigation?
   - Examples: null pointer with clear stack trace, typos, missing imports, off-by-one errors
   - If YES: Route directly to a fix agent (skip investigation)

3. **What is the complexity?** Simple or complex?
   - Simple: Single file changes, straightforward logic
   - Complex: Multi-file changes, architectural decisions, subtle bugs

4. **Which agent should handle it?**
   - For trivial issues: suggest 'simple'
   - For non-trivial simple issues: suggest 'simple' (will go through investigation first)
   - For complex issues: suggest 'complex' (will go through investigation first)
   - For domain-specific issues: suggest a user-defined agent if one matches

## Output Format

Create a file at \`.claude/triage-result.json\` with this structure:

For actionable issues:
\`\`\`json
{
  "actionable": true,
  "trivial": false,
  "complexity": "simple",
  "reasoning": "This is a straightforward null check that needs to be added...",
  "suggestedAgent": "simple",
  "labels": ["bug", "complexity-simple"]
}
\`\`\`

For trivial issues (skip investigation):
\`\`\`json
{
  "actionable": true,
  "trivial": true,
  "complexity": "simple",
  "reasoning": "Null pointer exception with clear stack trace pointing to line 42",
  "suggestedAgent": "simple"
}
\`\`\`

For non-actionable issues:
\`\`\`json
{
  "actionable": false,
  "reason": "needs-info",
  "comment": "Could you provide more details about the steps to reproduce this issue?",
  "reasoning": "The issue description lacks sufficient detail to investigate"
}
\`\`\`

## Important Notes

- Be conservative with "trivial" - only use it for genuinely obvious fixes
- When in doubt, route through investigation first
- Consider the full context, not just the title
- Don't make assumptions about what the fix should be

Begin your analysis now.
`.trim();
}

/**
 * Build a prompt for a specific agent with resolved rules
 *
 * @param agentName - Name of the agent (e.g., 'simple', 'complex', 'investigate')
 * @param trigger - Trigger plugin
 * @param event - Normalized event
 * @param resolvedRules - Array of resolved rules for this agent
 * @param tools - Available tools
 * @param investigationContext - Optional context from prior investigation
 * @param mainRepoFullName - Optional main repo name for secondary repos section
 * @param secondaryRepos - Optional secondary repos
 * @returns Prompt string for the agent
 */
export function buildAgentPrompt(
  agentName: string,
  trigger: TriggerPlugin,
  event: TriggerEvent,
  resolvedRules: ResolvedRule[],
  tools: Tool[],
  investigationContext?: InvestigationContext,
  mainRepoFullName?: string,
  secondaryRepos?: string[]
): string {
  const parts: string[] = [];

  // Header based on agent type
  const agentHeaders: Record<string, string> = {
    investigate: 'You are an investigation agent analyzing an issue to understand its root cause.',
    simple: 'You are a fix agent implementing a straightforward solution.',
    complex: 'You are a fix agent handling a complex implementation requiring careful planning.',
  };

  parts.push(agentHeaders[agentName] || `You are a ${agentName} agent.`);
  parts.push('');

  // Issue context
  const context = trigger.getPromptContext(event);
  parts.push('## Issue Details');
  parts.push('');
  parts.push(context);
  parts.push('');

  // Investigation context handoff (if provided)
  if (investigationContext) {
    parts.push(buildInvestigationHandoffSection(investigationContext));
    parts.push('');
  }

  // Tools section
  if (tools.length > 0) {
    parts.push('## Available Tools');
    parts.push('');
    parts.push('You have the following tools available. All tools are executable bash scripts in your PATH:');
    parts.push('');
    parts.push(tools.map((t) => `- \`${t.name}\` - ${t.description}`).join('\n'));
    parts.push('');
  }

  // Rules section
  if (resolvedRules.length > 0) {
    parts.push('## Rules and Guidelines');
    parts.push('');
    parts.push('Follow these rules when working on this issue:');
    parts.push('');

    for (const rule of resolvedRules) {
      if (rule.source === 'inline') {
        parts.push(`- ${rule.content}`);
      } else {
        // File-based rule - include source for context
        parts.push(`### From ${rule.source}`);
        parts.push('');
        parts.push(rule.content);
        parts.push('');
      }
    }
    parts.push('');
  }

  // Secondary repos section
  if (secondaryRepos && secondaryRepos.length > 0 && mainRepoFullName) {
    parts.push(buildSecondaryReposSection(mainRepoFullName, secondaryRepos));
    parts.push('');
  }

  // Agent-specific instructions
  parts.push(getAgentInstructions(agentName));
  parts.push('');

  // Output format
  parts.push(getAgentOutputFormat(agentName));

  return parts.join('\n').trim();
}

/**
 * Build the investigation handoff section for fix agents
 */
export function buildInvestigationHandoffSection(
  investigation: InvestigationContext
): string {
  return `
## Prior Investigation (AI-generated, may be inaccurate)

The following analysis was produced by a prior investigation step. Use this as a
starting point but verify key findings before implementing fixes.

### Root Cause Analysis
${investigation.rootCause}

### Files Identified
${investigation.filesInvolved.map((f) => `- \`${f}\``).join('\n')}

### Suggested Approach
${investigation.suggestedApproach}
${investigation.summary ? `\n### Full Summary\n${investigation.summary}` : ''}
`.trim();
}

/**
 * Get agent-specific instructions
 */
function getAgentInstructions(agentName: string): string {
  const instructions: Record<string, string> = {
    investigate: `
## Investigation Process

1. **Gather Information**: Use the available tools to fully understand the issue
2. **Explore Codebase**: Search for relevant files and understand the context
3. **Identify Root Cause**: Determine what's actually causing the issue
4. **Document Findings**: Record your analysis for the next agent

## Important

- Do NOT make any code changes
- Focus on understanding, not fixing
- Be thorough in exploring related code
- Document any assumptions you make
`,

    simple: `
## Fix Process

1. **Review Context**: Understand the issue and any prior investigation
2. **Implement Fix**: Make minimal, focused changes to fix the issue
3. **Test**: Run existing tests to verify the fix
4. **Commit**: Create a clear commit message

## Decision Criteria

**DO auto-fix if:**
- Clear, isolated bug with obvious fix
- Type errors, null checks, off-by-one errors
- Missing error handling
- Simple logic errors
- Test failures with clear assertions

**DON'T auto-fix if:**
- Requires architectural changes
- Involves security-sensitive code
- Could have unintended side effects
- You're not confident in the fix
`,

    complex: `
## Fix Process

1. **Review Context**: Understand the issue and any prior investigation thoroughly
2. **Plan Approach**: Consider the architectural implications of your changes
3. **Implement Systematically**: Make changes across affected files
4. **Test Comprehensively**: Ensure all affected functionality is tested
5. **Document**: Add comments for complex logic, update docs if needed
6. **Commit**: Create clear commit messages explaining the changes

## Considerations

- Think about edge cases and error handling
- Consider backwards compatibility if applicable
- Look for patterns in the codebase to follow
- If the fix is too large, consider breaking it into smaller PRs
`,
  };

  return instructions[agentName] || `
## Instructions

Complete the task as the ${agentName} agent.
Focus on quality and correctness.
`;
}

/**
 * Get agent-specific output format
 */
function getAgentOutputFormat(agentName: string): string {
  if (agentName === 'investigate') {
    return `
## Output Requirements

After your investigation, create a file at \`.claude/investigation.json\` with this structure:

\`\`\`json
{
  "rootCause": "What is causing this issue",
  "filesInvolved": ["src/path/to/file.ts"],
  "suggestedApproach": "How the fix should be implemented",
  "summary": "Full summary of your findings",
  "complexity": "simple" | "complex",
  "recommendedAgent": "simple" | "complex" | "<user-agent-name>"
}
\`\`\`

Do NOT make any code changes. Your findings will be passed to a fix agent.
`.trim();
  }

  // Fix agents (simple, complex, custom)
  return `
## Output Requirements

After your work, create a file at \`.claude/analysis.json\` with this structure:

\`\`\`json
{
  "canAutoFix": true | false,
  "confidence": "high" | "medium" | "low",
  "summary": "One-line description of the fix",
  "rootCause": "What was causing this issue",
  "proposedFix": "What you changed to fix it",
  "reason": "Why it cannot be auto-fixed (if !canAutoFix)",
  "filesInvolved": ["src/path/to/file.ts"],
  "complexity": "trivial" | "simple" | "moderate" | "complex",
  "escalation": {
    "targetAgent": "complex",
    "reason": "Requires architectural changes"
  }
}
\`\`\`

The \`escalation\` field is optional. Include it only if this task exceeds your capabilities
and should be re-run with a different agent.

## If canAutoFix is true AND confidence is "high":

1. Implement the fix with minimal, focused changes
2. Run existing tests if available to verify the fix
3. Add a test for the bug if straightforward
4. Commit your changes with message: "fix: <summary>"

## If canAutoFix is false OR confidence is not "high":

Stop after creating analysis.json. Do NOT make any code changes.
`.trim();
}

/**
 * Build prompt with config (agents/rules system)
 * This is the main entry point for prompt building
 */
export function buildPromptWithConfig(
  trigger: TriggerPlugin,
  event: TriggerEvent,
  tools: Tool[],
  config: AiBugsConfig | undefined,
  resolvedRules: ResolvedRule[],
  options: {
    agentName?: string;
    investigationContext?: InvestigationContext;
    mainRepoFullName?: string;
  } = {}
): string {
  const { agentName, investigationContext, mainRepoFullName } = options;
  const secondaryRepos = config?.config?.secondaryRepos;

  // If we have an agent name, use the agent-specific prompt
  if (agentName) {
    return buildAgentPrompt(
      agentName,
      trigger,
      event,
      resolvedRules,
      tools,
      investigationContext,
      mainRepoFullName,
      secondaryRepos
    );
  }

  // Default to investigation prompt (for backwards compatibility with callers that don't specify an agent)
  return buildInvestigationPrompt(trigger, event, tools);
}
