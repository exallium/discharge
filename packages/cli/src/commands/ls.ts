/**
 * discharge ls [--limit N] [--status ...]
 */

import Table from 'cli-table3';
import { DischargeClient } from '../client';
import { CliConfig } from '../config';
import { formatStatus, formatDuration, formatDate, error } from '../output';

interface Job {
  jobId: string;
  status: string;
  fixed: boolean | null;
  branchName: string | null;
  reason: string | null;
  durationMs: number | null;
  createdAt: string;
  triggerType: string;
}

export async function lsCommand(
  options: { limit?: string; status?: string },
  config: CliConfig
) {
  const client = new DischargeClient({
    serverUrl: config.serverUrl,
    token: config.token,
  });

  try {
    const result = await client.listJobs({
      projectId: config.projectId,
      limit: options.limit ? parseInt(options.limit, 10) : 20,
      status: options.status,
    });

    const jobs = result.jobs as Job[];

    if (jobs.length === 0) {
      console.log('No jobs found.');
      return;
    }

    const table = new Table({
      head: ['Job ID', 'Status', 'Fixed', 'Branch', 'Duration', 'Created'],
      style: { head: ['cyan'] },
    });

    for (const job of jobs) {
      table.push([
        job.jobId.slice(0, 8),
        formatStatus(job.status),
        job.fixed === true ? 'yes' : job.fixed === false ? 'no' : '-',
        job.branchName || '-',
        formatDuration(job.durationMs),
        formatDate(job.createdAt),
      ]);
    }

    console.log(table.toString());
  } catch (err) {
    error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
