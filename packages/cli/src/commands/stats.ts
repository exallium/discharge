/**
 * discharge stats
 */

import chalk from 'chalk';
import { DischargeClient } from '../client';
import { CliConfig } from '../config';
import { error } from '../output';

export async function statsCommand(config: CliConfig) {
  const client = new DischargeClient({
    serverUrl: config.serverUrl,
    token: config.token,
  });

  try {
    const result = await client.getStats(config.projectId);
    const queue = result.queue as Record<string, unknown>;
    const jobs = result.jobs as Record<string, unknown>;

    console.log();
    console.log(chalk.bold('Queue'));
    console.log('──────────────────────────────');
    console.log(`  Waiting:    ${queue.waiting}`);
    console.log(`  Active:     ${queue.active}`);
    console.log(`  Completed:  ${queue.completed}`);
    console.log(`  Failed:     ${queue.failed}`);
    console.log(`  Delayed:    ${queue.delayed}`);
    console.log(`  Paused:     ${queue.paused ? chalk.yellow('yes') : 'no'}`);

    console.log();
    console.log(chalk.bold('Jobs'));
    console.log('──────────────────────────────');
    console.log(`  Total:      ${jobs.total}`);
    console.log(`  Success:    ${chalk.green(String(jobs.success))}`);
    console.log(`  Failed:     ${chalk.red(String(jobs.failed))}`);
    console.log(`  Fixed:      ${jobs.fixedCount}`);
    if (jobs.avgDurationMs) {
      const avgSec = (jobs.avgDurationMs as number) / 1000;
      console.log(`  Avg Time:   ${avgSec.toFixed(1)}s`);
    }
    console.log();
  } catch (err) {
    error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
