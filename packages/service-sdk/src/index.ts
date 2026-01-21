/**
 * AI Bug Fixer Service SDK
 *
 * Shared interfaces and types for service plugins.
 */

// Trigger interface and types
export type {
  WebhookHeaders,
  WebhookRequest,
  TriggerEvent,
  Tool,
  AnalysisResult,
  FixStatus,
  WebhookConfig,
  PrefetchedData,
  SecretRequirement,
  TriggerProjectConfig,
  TriggerPlugin,
} from './interfaces/trigger';

// VCS interface and types
export type {
  VCSProjectConfig,
  PlanFileResult,
  PullRequest,
  VCSPlugin,
  VCSPluginFactory,
} from './interfaces/vcs';
export { formatPRBody } from './interfaces/vcs';

// Runner interface and types
export type {
  TriageResult,
  InvestigationContext,
  RunOptions,
  RunResult,
  ConversationRunOptions,
  RunnerPlugin,
} from './interfaces/runner';

// Service manifest interface
export type {
  ServiceValidationResult,
  ServiceManifest,
  ServiceConfig,
} from './interfaces/service';

// Conversation types
export type {
  ConversationState,
  RouteMode,
  WorkflowStatus,
  MessageRole,
  ConversationEventType,
  ConversationEvent,
  ConfidenceFactor,
  ConfidenceAssessment,
  PlanStep,
  PlanFile,
  ConversationAnalysisResult,
  RunnerAction,
  RunnerErrorType,
  RunnerConversationResult,
  ConversationMessage,
  ConversationConfig,
} from './types/conversation';

export {
  DEFAULT_ROUTING_TAGS,
  DEFAULT_CONVERSATION_CONFIG,
} from './types/conversation';

// Provider interfaces (for dependency injection)
export type {
  SecretsProvider,
  ProjectProvider,
  GitHubAuthProvider,
  LoggerProvider,
  ProviderConfig,
} from './interfaces/providers';

// SDK context (provider access)
export {
  configureProviders,
  isConfigured,
  resetProviders,
  getSecretsProvider,
  getProjectProvider,
  getGitHubAuthProvider,
  getLogger,
} from './context';

// Utilities
export type { ExecError } from './utils/errors';
export {
  isExecError,
  getErrorMessage,
  getErrorStack,
  toError,
} from './utils/errors';
