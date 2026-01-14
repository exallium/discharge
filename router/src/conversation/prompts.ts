/**
 * Conversation Prompts
 *
 * Prompt templates for conversation mode.
 * Used by runners to build AI prompts with conversation context.
 */

import type {
  ConversationEvent,
  ConversationMessage,
  PlanFile,
  RouteMode,
} from '../types/conversation';

/**
 * Build the system prompt for conversation mode
 */
export function buildConversationSystemPrompt(
  repo: { owner: string; name: string },
  target: { type: string; number: number | string; title: string },
  mode: RouteMode,
  iteration: number
): string {
  const modeInstructions = getModeInstructions(mode);

  return `You are an AI assistant integrated into a software development pipeline.

## Current Context
- Repository: ${repo.owner}/${repo.name}
- ${target.type === 'issue' ? 'Issue' : 'Pull Request'}: #${target.number} - ${target.title}
- Mode: ${mode}
- Iteration: ${iteration}

## Your Role
${modeInstructions}

## Output Format
Your response should be structured and actionable. When creating or updating plans, follow the plan file format. When providing feedback or asking questions, be clear and specific.

## Guidelines
1. Always acknowledge the feedback or events you're responding to
2. Be concise but thorough in your analysis
3. If you're unsure, ask clarifying questions
4. Track your progress through plan steps when executing
5. Report any blockers or concerns immediately`;
}

/**
 * Get mode-specific instructions
 */
function getModeInstructions(mode: RouteMode): string {
  switch (mode) {
    case 'auto_execute':
      return `You are in AUTO-EXECUTE mode. You should:
1. Analyze the issue/request thoroughly
2. Make the necessary code changes
3. Create commits with clear messages
4. Report your changes and any concerns
5. Ask for review if you encounter unexpected complexity`;

    case 'plan_review':
      return `You are in PLAN-REVIEW mode. You should:
1. Analyze the issue/request thoroughly
2. Create a detailed implementation plan
3. Wait for human approval before making changes
4. Iterate on the plan based on feedback
5. Only execute after explicit approval`;

    case 'assist_only':
      return `You are in ASSIST-ONLY mode. You should:
1. Analyze the issue/request thoroughly
2. Provide detailed guidance and recommendations
3. Create implementation plans when requested
4. DO NOT make any code changes
5. Help the human understand what needs to be done`;
  }
}

/**
 * Build user message from events
 */
export function buildUserMessage(
  events: ConversationEvent[],
  existingPlan?: PlanFile | null
): string {
  const parts: string[] = [];

  // Add existing plan context if available
  if (existingPlan) {
    parts.push('## Current Plan Status');
    parts.push(`- Status: ${existingPlan.metadata.status}`);
    parts.push(`- Iteration: ${existingPlan.metadata.iteration}`);
    parts.push(`- Confidence: ${(existingPlan.metadata.confidence * 100).toFixed(0)}%`);
    parts.push('');
  }

  // Format each event
  if (events.length === 1) {
    parts.push(formatEvent(events[0]));
  } else {
    parts.push(`## Events (${events.length} total)`);
    parts.push('');
    for (const event of events) {
      parts.push(formatEvent(event));
      parts.push('---');
    }
  }

  return parts.join('\n');
}

/**
 * Format a single event as message content
 */
export function formatEvent(event: ConversationEvent): string {
  const parts: string[] = [];

  switch (event.type) {
    case 'issue_opened':
      parts.push('## New Issue Opened');
      parts.push('');
      parts.push(`**Title:** ${event.target.title}`);
      parts.push('');
      if (event.target.labels.length > 0) {
        parts.push(`**Labels:** ${event.target.labels.join(', ')}`);
        parts.push('');
      }
      parts.push('**Description:**');
      parts.push(event.target.body || '_No description provided_');
      break;

    case 'issue_comment':
    case 'pr_comment':
      parts.push(`## Comment from @${event.payload.comment?.author || 'unknown'}`);
      parts.push('');
      parts.push(event.payload.comment?.body || '_Empty comment_');
      break;

    case 'pr_review': {
      const state = event.payload.review?.state || 'unknown';
      const stateEmoji = getReviewStateEmoji(state);
      parts.push(`## Review ${stateEmoji} from @${event.payload.review?.author || 'unknown'}`);
      parts.push(`**State:** ${state}`);
      parts.push('');
      if (event.payload.review?.body) {
        parts.push('**Review Comment:**');
        parts.push(event.payload.review.body);
        parts.push('');
      }
      if (event.payload.reviewComments && event.payload.reviewComments.length > 0) {
        parts.push('**Inline Comments:**');
        parts.push('');
        for (const comment of event.payload.reviewComments) {
          parts.push(`- **${comment.path}${comment.line ? `:${comment.line}` : ''}** (@${comment.author})`);
          if (comment.diffHunk) {
            parts.push('  ```diff');
            parts.push(`  ${comment.diffHunk.split('\n').join('\n  ')}`);
            parts.push('  ```');
          }
          parts.push(`  > ${comment.body}`);
          parts.push('');
        }
      }
      break;
    }

    case 'pr_review_comment':
      parts.push(`## Inline Comment from @${event.payload.comment?.author || 'unknown'}`);
      parts.push('');
      if (event.payload.reviewComments && event.payload.reviewComments.length > 0) {
        const comment = event.payload.reviewComments[0];
        parts.push(`**File:** ${comment.path}${comment.line ? `:${comment.line}` : ''}`);
        parts.push('');
        if (comment.diffHunk) {
          parts.push('**Context:**');
          parts.push('```diff');
          parts.push(comment.diffHunk);
          parts.push('```');
          parts.push('');
        }
        parts.push('**Comment:**');
        parts.push(comment.body);
      } else {
        parts.push(event.payload.comment?.body || '_Empty comment_');
      }
      break;

    case 'issue_labeled':
      parts.push(`## Label Added: \`${event.payload.label?.name}\``);
      break;

    default:
      parts.push(`## Event: ${event.type}`);
      parts.push('');
      parts.push('```json');
      parts.push(JSON.stringify(event.payload, null, 2));
      parts.push('```');
  }

  return parts.join('\n');
}

/**
 * Get emoji for review state
 */
function getReviewStateEmoji(state: string): string {
  switch (state.toLowerCase()) {
    case 'approved':
      return '(Approved)';
    case 'changes_requested':
      return '(Changes Requested)';
    case 'commented':
      return '(Comment)';
    case 'dismissed':
      return '(Dismissed)';
    default:
      return '';
  }
}

/**
 * Format conversation history for AI context
 */
export function formatConversationHistory(
  messages: ConversationMessage[]
): string {
  if (messages.length === 0) {
    return '';
  }

  const parts: string[] = [];
  parts.push('## Previous Conversation');
  parts.push('');

  for (const message of messages) {
    const roleLabel = message.role === 'assistant' ? 'AI' : 'User';
    const source = message.sourceAuthor ? ` (@${message.sourceAuthor})` : '';
    parts.push(`### ${roleLabel}${source}`);
    parts.push('');
    parts.push(message.content);
    parts.push('');
  }

  return parts.join('\n');
}

/**
 * Build plan creation prompt
 */
export function buildPlanCreationPrompt(
  context: string,
  routeMode: RouteMode
): string {
  return `Based on the issue/request described above, create a detailed implementation plan.

${context}

Your plan should include:
1. **Context**: Your understanding of the problem
2. **Approach**: High-level strategy for solving it
3. **Steps**: Detailed implementation steps with:
   - Clear title for each step
   - Description of what needs to be done
   - Specific tasks (as checklist items)
   - Files that will be modified
   - Estimated complexity (trivial/low/medium/high)
4. **Risks**: What could go wrong and mitigations
5. **Questions**: Any clarifications needed before proceeding

${routeMode === 'plan_review' ? 'This plan will be reviewed by a human before execution.' : ''}
${routeMode === 'assist_only' ? 'Note: You will NOT execute this plan. It is for guidance only.' : ''}`;
}

/**
 * Build plan iteration prompt
 */
export function buildPlanIterationPrompt(
  currentPlan: PlanFile,
  feedback: string
): string {
  return `The current plan has received feedback. Please update the plan based on this feedback.

## Current Plan
- Status: ${currentPlan.metadata.status}
- Iteration: ${currentPlan.metadata.iteration}
- Confidence: ${(currentPlan.metadata.confidence * 100).toFixed(0)}%

## Feedback
${feedback}

## Instructions
1. Address each piece of feedback
2. Update the relevant sections of the plan
3. Add any new steps or modify existing ones as needed
4. Update risks and questions if applicable
5. Explain what changes you made in response to the feedback`;
}

/**
 * Build execution prompt
 */
export function buildExecutionPrompt(
  plan: PlanFile,
  stepIndex?: number
): string {
  const step = stepIndex !== undefined ? plan.sections.steps[stepIndex] : null;
  const stepNum = stepIndex ?? 0;

  if (step) {
    return `Execute step ${stepNum + 1} of the approved plan:

## Step: ${step.title}
**Complexity:** ${step.estimatedComplexity}
**Files:** ${step.files.join(', ') || 'TBD'}

${step.description}

### Tasks
${step.tasks.map(t => `- [ ] ${t}`).join('\n')}

## Instructions
1. Complete each task in order
2. Create clear commit messages for each logical change
3. Run tests if applicable
4. Report any issues or blockers immediately`;
  }

  return `Execute the approved plan:

## Plan Overview
${plan.sections.approach}

## Steps
${plan.sections.steps.map((s, i) => `${i + 1}. ${s.title} (${s.estimatedComplexity})`).join('\n')}

## Instructions
1. Work through each step in order
2. Create clear commit messages for each logical change
3. Run tests between steps when possible
4. Report progress and any issues`;
}
