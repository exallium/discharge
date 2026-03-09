/**
 * CLI Output Helpers
 */

import chalk from 'chalk';

export function formatStatus(status: string): string {
  switch (status) {
    case 'pending':
      return chalk.yellow('pending');
    case 'running':
      return chalk.blue('running');
    case 'success':
      return chalk.green('success');
    case 'failed':
      return chalk.red('failed');
    case 'skipped':
      return chalk.gray('skipped');
    default:
      return status;
  }
}

export function formatDuration(ms: number | null): string {
  if (!ms) return '-';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

export function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString();
}

export function error(msg: string): void {
  console.error(chalk.red('Error:'), msg);
}

export function success(msg: string): void {
  console.log(chalk.green('✓'), msg);
}

export function info(msg: string): void {
  console.log(chalk.blue('ℹ'), msg);
}
