/**
 * discharge push "<title>" [--desc "..."] [--mode triage|investigate] [--pr|--no-pr] [--watch]
 */

import { execSync } from 'child_process';
import ora from 'ora';
import { DischargeClient } from '../client';
import { CliConfig } from '../config';
import { success, error, info } from '../output';
import { watchJob } from './watch';

export async function pushCommand(
  title: string,
  options: {
    desc?: string;
    mode?: string;
    pr?: boolean;
    noPr?: boolean;
    watch?: boolean;
  },
  config: CliConfig
) {
  const client = new DischargeClient({
    serverUrl: config.serverUrl,
    token: config.token,
  });

  // Resolve skipPR: CLI flags > config > default (true = skip)
  let skipPR = config.skipPR ?? true;
  if (options.pr) skipPR = false;
  if (options.noPr) skipPR = true;

  // Resolve git author
  let gitAuthor: { name: string; email: string } | undefined;
  if (config.gitAuthor === 'auto') {
    try {
      const name = execSync('git config user.name', { encoding: 'utf-8' }).trim();
      const email = execSync('git config user.email', { encoding: 'utf-8' }).trim();
      if (name && email) {
        gitAuthor = { name, email };
      }
    } catch {
      // Fall back to default
    }
  } else if (config.gitAuthor && typeof config.gitAuthor === 'object') {
    gitAuthor = config.gitAuthor;
  }

  const spinner = ora('Submitting task...').start();

  try {
    const result = await client.submitJob({
      projectId: config.projectId,
      title,
      description: options.desc,
      mode: options.mode || config.defaultMode,
      skipPR,
      gitAuthor,
    });

    spinner.succeed(`Task queued: ${result.jobId}`);
    info(`Project: ${config.projectId}`);
    info(`Title: ${title}`);

    if (options.watch) {
      console.log();
      await watchJob(result.jobId, config);
    }
  } catch (err) {
    spinner.fail('Failed to submit task');
    error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
