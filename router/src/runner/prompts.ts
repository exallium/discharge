import { TriggerPlugin, TriggerEvent, Tool } from '../triggers/base';

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
