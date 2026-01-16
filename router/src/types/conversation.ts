/**
 * Conversation types for the conversational feedback loop system
 *
 * These types are plugin-agnostic and work with any trigger/runner/VCS combination.
 */

/**
 * Conversation state machine states
 */
export type ConversationState = 'idle' | 'running' | 'draining';

/**
 * Routing modes determined by tags or confidence
 */
export type RouteMode = 'plan_review' | 'auto_execute' | 'assist_only';

/**
 * Workflow status for plan-based conversations
 */
export type WorkflowStatus =
  | 'pending'
  | 'planning'
  | 'reviewing'
  | 'approved'
  | 'executing'
  | 'complete'
  | 'failed';

/**
 * Message role in conversation history
 */
export type MessageRole = 'user' | 'assistant' | 'system';

/**
 * Conversation event types
 */
export type ConversationEventType =
  | 'issue_opened'
  | 'issue_comment'
  | 'issue_labeled'
  | 'pr_comment'
  | 'pr_review'
  | 'pr_review_comment'
  | 'approval'
  | 'manual_trigger';

/**
 * Generic conversation event that triggers normalize platform events to
 */
export interface ConversationEvent {
  /** Event type */
  type: ConversationEventType | string;

  /** Source platform info */
  source: {
    platform: string;        // 'github', 'gitlab', 'slack', etc.
    externalId: string;      // Platform-specific identifier
    url?: string;            // Web URL for the event
  };

  /** Target issue/PR/ticket info */
  target: {
    type: string;            // 'issue' | 'pull_request' | 'ticket' etc.
    number: number | string;
    title: string;
    body: string;
    labels: string[];
    url?: string;            // Web URL for the target
  };

  /** Event-specific payload */
  payload: {
    action?: string;
    comment?: {
      body: string;
      author: string;
      id: string | number;
      url?: string;
    };
    review?: {
      state: string;         // 'approved' | 'changes_requested' | 'commented'
      body: string | null;
      author: string;
      id: string | number;
      url?: string;
    };
    reviewComments?: Array<{
      id?: string | number;
      path: string;
      line?: number;
      diffHunk?: string;
      body: string;
      author: string;
    }>;
    label?: {
      name: string;
      color?: string;
    };
  };

  /** ISO 8601 timestamp */
  timestamp: string;
}

/**
 * Confidence factor for auto-routing assessment
 */
export interface ConfidenceFactor {
  factor: string;
  impact: 'positive' | 'negative' | 'neutral';
  weight: number;
  description: string;
}

/**
 * Confidence assessment for determining auto-execute vs plan-review
 */
export interface ConfidenceAssessment {
  /** Overall confidence score (0.0 - 1.0) */
  score: number;

  /** Threshold for auto-execution (from config) */
  autoExecuteThreshold: number;

  /** Factors that contributed to the score */
  factors: ConfidenceFactor[];

  /** Final recommendation */
  recommendation: 'auto_execute' | 'request_review';

  /** Human-readable reasoning */
  reasoning: string;
}

/**
 * Plan step for plan file structure
 */
export interface PlanStep {
  title: string;
  description: string;
  tasks: string[];
  files: string[];
  estimatedComplexity: 'trivial' | 'low' | 'medium' | 'high';
}

/**
 * Plan file structure (for markdown serialization)
 */
export interface PlanFile {
  metadata: {
    issue: number | string;
    status: 'draft' | 'reviewing' | 'approved' | 'executing' | 'complete';
    iteration: number;
    confidence: number;
    created: string;
    updated: string;
    author: string;
  };
  sections: {
    context: string;
    approach: string;
    steps: PlanStep[];
    risks: string[];
    questions: string[];
  };
}

/**
 * Analysis result for PR creation (matches one-shot flow)
 */
export interface ConversationAnalysisResult {
  summary: string;
  rootCause: string;
  proposedFix: string;
  filesInvolved: string[];
  confidence: 'high' | 'medium' | 'low';
  complexity: 'trivial' | 'simple' | 'moderate' | 'complex';
  canAutoFix: boolean;
  reason?: string;
}

/**
 * Runner action types for conversation results
 */
export type RunnerAction =
  | { type: 'create_plan'; plan: PlanFile; branch?: string }
  | { type: 'update_plan'; content: string; planVersion: number }
  | { type: 'execute'; description: string }
  | { type: 'create_pr'; analysis: ConversationAnalysisResult; branchName: string }
  | { type: 'comment'; body: string }
  | { type: 'request_info'; questions: string[] };

/**
 * Error classification for runner failures
 */
export type RunnerErrorType =
  | 'transient'        // Temporary failure, can retry
  | 'auth_expired'     // OAuth/API token expired, admin needs to re-login
  | 'rate_limited'     // API rate limit hit
  | 'invalid_config'   // Configuration error
  | 'unknown';         // Unknown error

/**
 * Result from runner's conversation execution
 */
export interface RunnerConversationResult {
  /** Text response from the runner/AI */
  response: string;

  /** Structured action to take */
  action: RunnerAction;

  /** Updated confidence assessment */
  confidence?: ConfidenceAssessment;

  /** Whether the task is complete */
  complete?: boolean;

  /** Error classification if execution failed */
  errorType?: RunnerErrorType;

  /** Whether this error requires admin intervention */
  requiresAdminIntervention?: boolean;
}

/**
 * Conversation message for history
 */
export interface ConversationMessage {
  role: MessageRole;
  content: string;
  timestamp: string;
  sourceType?: string;
  sourceId?: string;
  sourceAuthor?: string;
}

/**
 * Configuration for conversation behavior
 */
export interface ConversationConfig {
  autoExecuteThreshold?: number;
  planDirectory?: string;
  maxIterations?: number;
  routingTags?: {
    plan?: string;
    auto?: string;
    assist?: string;
  };
}

/**
 * Default routing tags
 */
export const DEFAULT_ROUTING_TAGS = {
  plan: 'ai:plan',
  auto: 'ai:auto',
  assist: 'ai:assist',
} as const;

/**
 * Default conversation configuration
 */
export const DEFAULT_CONVERSATION_CONFIG: ConversationConfig = {
  autoExecuteThreshold: 0.85,
  planDirectory: '.ai-bug-fixer/plans',
  maxIterations: 20,
  routingTags: DEFAULT_ROUTING_TAGS,
};
