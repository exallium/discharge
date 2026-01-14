/**
 * Plugin settings schema definitions
 *
 * These interfaces allow plugins (triggers, VCS, runners) to declare
 * their configuration requirements. The admin UI dynamically renders
 * forms based on these schemas.
 */

/**
 * A single setting definition within a plugin's schema
 */
export interface SettingDefinition {
  /** Unique key for this setting (e.g., 'token', 'webhook_secret') */
  key: string;

  /** Human-readable label (e.g., 'API Token', 'Webhook Secret') */
  label: string;

  /** Input type for the admin UI */
  type: 'text' | 'password' | 'url' | 'boolean' | 'number' | 'select';

  /** Whether this setting is required */
  required: boolean;

  /** Help text shown below the input */
  description?: string;

  /** Placeholder text for the input */
  placeholder?: string;

  /** Default value if not set */
  defaultValue?: string | number | boolean;

  /** Options for 'select' type */
  options?: Array<{ value: string; label: string }>;

  /** Validation function (runs client-side and server-side) */
  validate?: (value: string) => boolean | string;

  /** Whether this setting should be stored encrypted */
  encrypted?: boolean;

  /** Group settings visually (e.g., 'Authentication', 'Advanced') */
  group?: string;
}

/**
 * A plugin's settings schema
 * Exported by triggers, VCS plugins, and runners
 */
export interface PluginSettingsSchema {
  /** Unique category identifier (e.g., 'github', 'sentry', 'circleci') */
  category: string;

  /** Human-readable name (e.g., 'GitHub', 'Sentry', 'CircleCI') */
  displayName: string;

  /** Optional description of the plugin */
  description?: string;

  /** Optional icon name or URL */
  icon?: string;

  /** Settings definitions */
  settings: SettingDefinition[];

  /** Optional URL to documentation */
  docsUrl?: string;

  /** Optional test connection function key (admin API will call this) */
  testConnection?: string;
}

/**
 * Registry of all plugin settings schemas
 */
const settingsRegistry = new Map<string, PluginSettingsSchema>();

/**
 * Register a plugin's settings schema
 */
export function registerSettingsSchema(schema: PluginSettingsSchema): void {
  if (settingsRegistry.has(schema.category)) {
    console.warn(`[SettingsRegistry] Overwriting existing schema for category: ${schema.category}`);
  }
  settingsRegistry.set(schema.category, schema);
}

/**
 * Get a plugin's settings schema by category
 */
export function getSettingsSchema(category: string): PluginSettingsSchema | undefined {
  return settingsRegistry.get(category);
}

/**
 * Get all registered settings schemas
 */
export function getAllSettingsSchemas(): PluginSettingsSchema[] {
  return Array.from(settingsRegistry.values());
}

/**
 * Clear all registered schemas (for testing)
 */
export function clearSettingsSchemas(): void {
  settingsRegistry.clear();
}

// ============================================================================
// Built-in Settings Schemas
// ============================================================================

/**
 * System settings schema
 */
export const systemSettingsSchema: PluginSettingsSchema = {
  category: 'system',
  displayName: 'System',
  description: 'General system configuration',
  settings: [
    {
      key: 'base_url',
      label: 'Base URL',
      type: 'url',
      required: false,
      description: 'Public URL where this server is accessible (used for webhook URLs)',
      placeholder: 'https://ai-bug-fixer.example.com',
      group: 'General',
    },
    {
      key: 'log_level',
      label: 'Log Level',
      type: 'select',
      required: false,
      description: 'Logging verbosity',
      defaultValue: 'info',
      options: [
        { value: 'error', label: 'Error' },
        { value: 'warn', label: 'Warning' },
        { value: 'info', label: 'Info' },
        { value: 'debug', label: 'Debug' },
      ],
      group: 'General',
    },
    {
      key: 'worker_concurrency',
      label: 'Worker Concurrency',
      type: 'number',
      required: false,
      description: 'Number of concurrent job workers',
      defaultValue: 2,
      group: 'General',
    },
  ],
};

/**
 * GitHub settings schema
 */
export const githubSettingsSchema: PluginSettingsSchema = {
  category: 'github',
  displayName: 'GitHub',
  description: 'GitHub API and webhook configuration',
  icon: 'github',
  docsUrl: 'https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token',
  testConnection: 'github.test',
  settings: [
    {
      key: 'token',
      label: 'Personal Access Token',
      type: 'password',
      required: true,
      description: 'GitHub PAT with repo, issues, and pull_request scopes',
      placeholder: 'ghp_xxxxxxxxxxxxxxxxxxxx',
      encrypted: true,
      validate: (v) => v.startsWith('ghp_') || v.startsWith('github_pat_') || 'Token must start with ghp_ or github_pat_',
      group: 'Authentication',
    },
    {
      key: 'webhook_secret',
      label: 'Webhook Secret',
      type: 'password',
      required: true,
      description: 'Secret used to validate webhook signatures',
      placeholder: 'your-webhook-secret',
      encrypted: true,
      validate: (v) => v.length >= 20 || 'Secret must be at least 20 characters',
      group: 'Authentication',
    },
  ],
};

/**
 * Sentry settings schema
 */
export const sentrySettingsSchema: PluginSettingsSchema = {
  category: 'sentry',
  displayName: 'Sentry',
  description: 'Sentry error tracking integration',
  icon: 'sentry',
  docsUrl: 'https://docs.sentry.io/api/auth/',
  testConnection: 'sentry.test',
  settings: [
    {
      key: 'auth_token',
      label: 'Auth Token',
      type: 'password',
      required: true,
      description: 'Sentry authentication token with project:read and event:read scopes',
      encrypted: true,
      group: 'Authentication',
    },
    {
      key: 'org',
      label: 'Organization Slug',
      type: 'text',
      required: true,
      description: 'Your Sentry organization slug',
      placeholder: 'my-org',
      group: 'Authentication',
    },
    {
      key: 'webhook_secret',
      label: 'Webhook Secret',
      type: 'password',
      required: false,
      description: 'Optional secret for validating webhook signatures',
      encrypted: true,
      group: 'Webhooks',
    },
  ],
};

/**
 * CircleCI settings schema
 */
export const circleCISettingsSchema: PluginSettingsSchema = {
  category: 'circleci',
  displayName: 'CircleCI',
  description: 'CircleCI CI/CD integration',
  icon: 'circleci',
  docsUrl: 'https://circleci.com/docs/managing-api-tokens/',
  testConnection: 'circleci.test',
  settings: [
    {
      key: 'token',
      label: 'Personal API Token',
      type: 'password',
      required: true,
      description: 'CircleCI personal API token',
      encrypted: true,
      group: 'Authentication',
    },
    {
      key: 'webhook_secret',
      label: 'Webhook Secret',
      type: 'password',
      required: false,
      description: 'Optional secret for validating webhook signatures',
      encrypted: true,
      group: 'Webhooks',
    },
  ],
};

/**
 * Notifications settings schema
 */
export const notificationsSettingsSchema: PluginSettingsSchema = {
  category: 'notifications',
  displayName: 'Notifications',
  description: 'Configure notification channels',
  settings: [
    {
      key: 'discord_webhook_url',
      label: 'Discord Webhook URL',
      type: 'url',
      required: false,
      description: 'Discord webhook URL for notifications',
      placeholder: 'https://discord.com/api/webhooks/...',
      encrypted: true,
      group: 'Discord',
    },
    {
      key: 'slack_webhook_url',
      label: 'Slack Webhook URL',
      type: 'url',
      required: false,
      description: 'Slack webhook URL for notifications',
      placeholder: 'https://hooks.slack.com/services/...',
      encrypted: true,
      group: 'Slack',
    },
  ],
};

/**
 * Conversation settings schema (global defaults)
 */
export const conversationSettingsSchema: PluginSettingsSchema = {
  category: 'conversation',
  displayName: 'Conversation Mode',
  description: 'Configure the conversational feedback loop for plan-review workflows',
  settings: [
    {
      key: 'enabled',
      label: 'Enable Conversation Mode',
      type: 'boolean',
      required: false,
      description: 'Enable the conversational feedback loop for projects that support it',
      defaultValue: false,
      group: 'General',
    },
    {
      key: 'auto_execute_threshold',
      label: 'Auto-Execute Threshold',
      type: 'number',
      required: false,
      description: 'Confidence score (0.0-1.0) required for automatic execution without review',
      defaultValue: 0.85,
      placeholder: '0.85',
      group: 'General',
    },
    {
      key: 'max_iterations',
      label: 'Max Iterations',
      type: 'number',
      required: false,
      description: 'Maximum number of feedback iterations per conversation',
      defaultValue: 20,
      group: 'General',
    },
    {
      key: 'plan_directory',
      label: 'Plan Directory',
      type: 'text',
      required: false,
      description: 'Directory path for storing plan files in target repositories',
      defaultValue: '.ai-bug-fixer/plans',
      placeholder: '.ai-bug-fixer/plans',
      group: 'Storage',
    },
    {
      key: 'routing_tag_plan',
      label: 'Plan Tag',
      type: 'text',
      required: false,
      description: 'Label/tag to trigger plan-review mode',
      defaultValue: 'ai:plan',
      placeholder: 'ai:plan',
      group: 'Routing Tags',
    },
    {
      key: 'routing_tag_auto',
      label: 'Auto Tag',
      type: 'text',
      required: false,
      description: 'Label/tag to trigger auto-execute mode',
      defaultValue: 'ai:auto',
      placeholder: 'ai:auto',
      group: 'Routing Tags',
    },
    {
      key: 'routing_tag_assist',
      label: 'Assist Tag',
      type: 'text',
      required: false,
      description: 'Label/tag to trigger assist-only mode (no code changes)',
      defaultValue: 'ai:assist',
      placeholder: 'ai:assist',
      group: 'Routing Tags',
    },
    {
      key: 'conversation_ttl_days',
      label: 'Conversation TTL (days)',
      type: 'number',
      required: false,
      description: 'Number of days to keep conversation history before cleanup',
      defaultValue: 30,
      group: 'Storage',
    },
  ],
};

/**
 * Project conversation settings schema (for project-level overrides)
 * Used in the project edit form to configure conversation mode per project
 */
export const projectConversationSettingsSchema: SettingDefinition[] = [
  {
    key: 'conversation_enabled',
    label: 'Enable Conversation Mode',
    type: 'boolean',
    required: false,
    description: 'Enable the conversational feedback loop for this project',
    defaultValue: false,
    group: 'Conversation',
  },
  {
    key: 'conversation_auto_execute_threshold',
    label: 'Auto-Execute Threshold',
    type: 'number',
    required: false,
    description: 'Override the global auto-execute threshold for this project (0.0-1.0)',
    placeholder: '0.85',
    group: 'Conversation',
  },
  {
    key: 'conversation_max_iterations',
    label: 'Max Iterations',
    type: 'number',
    required: false,
    description: 'Override the maximum feedback iterations for this project',
    placeholder: '20',
    group: 'Conversation',
  },
  {
    key: 'conversation_routing_tag_plan',
    label: 'Plan Tag',
    type: 'text',
    required: false,
    description: 'Custom label/tag to trigger plan-review mode',
    placeholder: 'ai:plan',
    group: 'Conversation',
  },
  {
    key: 'conversation_routing_tag_auto',
    label: 'Auto Tag',
    type: 'text',
    required: false,
    description: 'Custom label/tag to trigger auto-execute mode',
    placeholder: 'ai:auto',
    group: 'Conversation',
  },
  {
    key: 'conversation_routing_tag_assist',
    label: 'Assist Tag',
    type: 'text',
    required: false,
    description: 'Custom label/tag to trigger assist-only mode',
    placeholder: 'ai:assist',
    group: 'Conversation',
  },
];

// Register built-in schemas
registerSettingsSchema(systemSettingsSchema);
registerSettingsSchema(githubSettingsSchema);
registerSettingsSchema(sentrySettingsSchema);
registerSettingsSchema(circleCISettingsSchema);
registerSettingsSchema(notificationsSettingsSchema);
registerSettingsSchema(conversationSettingsSchema);
