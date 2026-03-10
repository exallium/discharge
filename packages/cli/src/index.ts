#!/usr/bin/env node

/**
 * Discharge CLI
 *
 * AI Kanban mode - submit and monitor AI tasks locally.
 */

import { Command } from 'commander';
import { resolveConfig, CliConfig } from './config';
import { initCommand } from './commands/init';
import { linkCommand } from './commands/link';
import { pushCommand } from './commands/push';
import { lsCommand } from './commands/ls';
import { statusCommand } from './commands/status';
import { watchCommand } from './commands/watch';
import { statsCommand } from './commands/stats';
import { error } from './output';

const program = new Command();

program
  .name('discharge')
  .description('Discharge CLI - AI Kanban mode')
  .version('1.0.0');

/**
 * Require config for most commands
 */
function requireConfig(): CliConfig {
  const config = resolveConfig();
  if (!config) {
    error(
      'Not configured. Run `discharge init` to set up, or:\n' +
      '  discharge link <url> <project-id>\n' +
      '  export DISCHARGE_TOKEN=<token>'
    );
    process.exit(1);
  }
  return config;
}

// ──────────────────────────────────────────
// Commands
// ──────────────────────────────────────────

program
  .command('init')
  .description('Set up Discharge for this project (interactive)')
  .option('--server <url>', 'Discharge server URL')
  .action(async (options: { server?: string }) => {
    await initCommand(options);
  });

program
  .command('link <url> <project-id>')
  .description('Save server connection config')
  .option('--global', 'Save to global config (~/.config/discharge/config.json)')
  .action((url: string, projectId: string, options: { global?: boolean }) => {
    linkCommand(url, projectId, options);
  });

program
  .command('push <title>')
  .description('Submit a task for AI processing')
  .option('--desc <description>', 'Task description')
  .option('--mode <mode>', 'Execution mode (triage|investigate)')
  .option('--pr', 'Create a PR with the fix')
  .option('--no-pr', 'Skip PR creation (default)')
  .option('--watch', 'Watch job progress after submission')
  .action(async (title: string, options) => {
    const config = requireConfig();
    await pushCommand(title, options, config);
  });

program
  .command('ls')
  .description('List recent jobs')
  .option('--limit <n>', 'Number of jobs to show', '20')
  .option('--status <status>', 'Filter by status (pending|running|success|failed)')
  .action(async (options) => {
    const config = requireConfig();
    await lsCommand(options, config);
  });

program
  .command('status <job-id>')
  .description('Show detailed job status')
  .action(async (jobId: string) => {
    const config = requireConfig();
    await statusCommand(jobId, config);
  });

program
  .command('watch <job-id>')
  .description('Stream job progress until completion')
  .action(async (jobId: string) => {
    const config = requireConfig();
    await watchCommand(jobId, config);
  });

program
  .command('stats')
  .description('Show queue and job statistics')
  .action(async () => {
    const config = requireConfig();
    await statsCommand(config);
  });

program.parse();
