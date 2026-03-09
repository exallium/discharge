/**
 * discharge watch <job-id>
 *
 * Stream progress via SSE until completion
 */

import EventSource from 'eventsource';
import ora from 'ora';
import chalk from 'chalk';
import { DischargeClient } from '../client';
import { CliConfig } from '../config';
import { error } from '../output';

export async function watchJob(jobId: string, config: CliConfig): Promise<void> {
  const client = new DischargeClient({
    serverUrl: config.serverUrl,
    token: config.token,
  });

  const streamUrl = client.getStreamUrl(jobId);
  const spinner = ora('Watching job...').start();

  return new Promise<void>((resolve, reject) => {
    const es = new EventSource(streamUrl, {
      headers: {
        Authorization: `Bearer ${config.token}`,
      },
    });

    es.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        switch (data.type) {
          case 'status':
            spinner.text = `Status: ${data.data.status}`;
            break;
          case 'job_started':
            spinner.text = 'Job running...';
            break;
          case 'job_completed':
            spinner.succeed('Job completed');
            if (data.data.fixed) {
              console.log(chalk.green('  Fix applied'));
            }
            if (data.data.branchName) {
              console.log(`  Branch: ${chalk.cyan(data.data.branchName)}`);
            }
            if (data.data.prUrl) {
              console.log(`  PR: ${data.data.prUrl}`);
            }
            es.close();
            resolve();
            break;
          case 'job_failed':
            spinner.fail('Job failed');
            if (data.data.error) {
              console.log(chalk.red(`  ${data.data.error.slice(0, 200)}`));
            }
            es.close();
            resolve();
            break;
          case 'job_skipped':
            spinner.warn('Job skipped');
            if (data.data.reason) {
              console.log(`  Reason: ${data.data.reason}`);
            }
            es.close();
            resolve();
            break;
        }
      } catch {
        // ignore parse errors
      }
    };

    es.onerror = (err: Event) => {
      spinner.fail('Connection lost');
      es.close();
      reject(new Error('SSE connection failed'));
    };
  });
}

export async function watchCommand(jobId: string, config: CliConfig) {
  try {
    await watchJob(jobId, config);
  } catch (err) {
    error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
