/**
 * discharge status <job-id>
 */

import chalk from 'chalk';
import { DischargeClient } from '../client';
import { CliConfig } from '../config';
import { formatStatus, formatDuration, formatDate, error } from '../output';

interface Job {
  jobId: string;
  status: string;
  fixed: boolean | null;
  branchName: string | null;
  reason: string | null;
  prUrl: string | null;
  durationMs: number | null;
  analysis: unknown;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  triggerType: string;
  projectId: string;
}

export async function statusCommand(jobId: string, config: CliConfig) {
  const client = new DischargeClient({
    serverUrl: config.serverUrl,
    token: config.token,
  });

  try {
    const result = await client.getJob(jobId);
    const job = result.job as Job;

    console.log();
    console.log(chalk.bold('Job Status'));
    console.log('──────────────────────────────');
    console.log(`  Job ID:     ${job.jobId}`);
    console.log(`  Status:     ${formatStatus(job.status)}`);
    console.log(`  Project:    ${job.projectId}`);
    console.log(`  Fixed:      ${job.fixed === true ? chalk.green('yes') : job.fixed === false ? chalk.red('no') : '-'}`);

    if (job.branchName) {
      console.log(`  Branch:     ${chalk.cyan(job.branchName)}`);
    }
    if (job.prUrl) {
      console.log(`  PR:         ${job.prUrl}`);
    }
    if (job.reason) {
      console.log(`  Reason:     ${job.reason}`);
    }
    if (job.error) {
      console.log(`  Error:      ${chalk.red(job.error.slice(0, 200))}`);
    }

    console.log(`  Duration:   ${formatDuration(job.durationMs)}`);
    console.log(`  Created:    ${formatDate(job.createdAt)}`);
    if (job.startedAt) {
      console.log(`  Started:    ${formatDate(job.startedAt)}`);
    }
    if (job.completedAt) {
      console.log(`  Completed:  ${formatDate(job.completedAt)}`);
    }
    console.log();
  } catch (err) {
    error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
