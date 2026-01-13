import { NextResponse } from 'next/server';

// Force dynamic rendering - don't pre-render at build time
export const dynamic = 'force-dynamic';
import { getConnection, getQueueStats } from '@/src/queue';
import { triggers } from '@/src/triggers';
import { getAllVCSPlugins } from '@/src/vcs';
import { getAllRunners } from '@/src/runner';
import { getErrorMessage } from '@/src/types/errors';
import { checkDatabaseHealth, isDatabaseInitialized } from '@/src/db';

/**
 * Health check status
 */
interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  version: string;
  checks: {
    database: CheckResult;
    redis: CheckResult;
    queue: CheckResult;
    triggers: CheckResult;
    vcs: CheckResult;
    runners: CheckResult;
  };
}

/**
 * Individual check result
 */
interface CheckResult {
  status: 'pass' | 'warn' | 'fail';
  message?: string;
  [key: string]: unknown;
}

const startTime = Date.now();

/**
 * Check Redis connectivity
 */
async function checkRedis(): Promise<CheckResult> {
  try {
    const connection = getConnection();
    const start = Date.now();
    await connection.ping();
    const latency = Date.now() - start;

    const info = await connection.info('server');
    const version = info.match(/redis_version:([^\r\n]+)/)?.[1] || 'unknown';
    const uptime = info.match(/uptime_in_seconds:(\d+)/)?.[1] || '0';

    return {
      status: latency < 100 ? 'pass' : 'warn',
      message: latency < 100 ? 'Redis healthy' : 'Redis slow',
      latency: `${latency}ms`,
      version,
      uptime: `${uptime}s`,
    };
  } catch (error) {
    return {
      status: 'fail',
      message: 'Redis connection failed',
      error: getErrorMessage(error),
    };
  }
}

/**
 * Check queue status
 */
async function checkQueue(): Promise<CheckResult> {
  try {
    const stats = await getQueueStats();

    // Warning if too many failed jobs
    const hasManyFailed = stats.failed > 50;

    // Warning if queue is paused
    const isPaused = stats.paused;

    return {
      status: hasManyFailed || isPaused ? 'warn' : 'pass',
      message: isPaused
        ? 'Queue is paused'
        : hasManyFailed
          ? 'High number of failed jobs'
          : 'Queue healthy',
      stats,
    };
  } catch (error) {
    return {
      status: 'fail',
      message: 'Queue check failed',
      error: getErrorMessage(error),
    };
  }
}

/**
 * Check trigger plugins
 */
function checkTriggers(): CheckResult {
  const registeredCount = triggers.length;
  const triggerIds = triggers.map(t => t.id);

  return {
    status: registeredCount > 0 ? 'pass' : 'warn',
    message:
      registeredCount > 0
        ? `${registeredCount} trigger(s) registered`
        : 'No triggers registered',
    count: registeredCount,
    triggers: triggerIds,
  };
}

/**
 * Check VCS plugins
 */
function checkVCS(): CheckResult {
  const plugins = getAllVCSPlugins();
  const registeredCount = plugins.length;
  const vcsTypes = plugins.map(v => v.type);

  return {
    status: registeredCount > 0 ? 'pass' : 'warn',
    message:
      registeredCount > 0
        ? `${registeredCount} VCS plugin(s) registered`
        : 'No VCS plugins registered',
    count: registeredCount,
    vcs: vcsTypes,
  };
}

/**
 * Check runner plugins
 */
function checkRunners(): CheckResult {
  const runnerPlugins = getAllRunners();
  const registeredCount = runnerPlugins.length;
  const runnerIds = runnerPlugins.map(r => r.id);

  return {
    status: registeredCount > 0 ? 'pass' : 'fail',
    message:
      registeredCount > 0
        ? `${registeredCount} runner(s) registered`
        : 'No runners registered',
    count: registeredCount,
    runners: runnerIds,
  };
}

/**
 * Check database health
 */
async function checkDatabase(): Promise<CheckResult> {
  try {
    if (!isDatabaseInitialized()) {
      return {
        status: 'fail',
        message: 'Database not initialized',
      };
    }

    const health = await checkDatabaseHealth();

    return {
      status: health.latency < 100 ? 'pass' : 'warn',
      message: health.latency < 100 ? 'Database healthy' : 'Database slow',
      latency: `${health.latency}ms`,
      version: health.version,
    };
  } catch (error) {
    return {
      status: 'fail',
      message: 'Database connection failed',
      error: getErrorMessage(error),
    };
  }
}

/**
 * GET /api/health - Comprehensive health check
 */
export async function GET() {
  try {
    const checks = await Promise.all([
      checkDatabase(),
      checkRedis(),
      checkQueue(),
      Promise.resolve(checkTriggers()),
      Promise.resolve(checkVCS()),
      Promise.resolve(checkRunners()),
    ]);

    const [database, redis, queue, triggersCheck, vcsCheck, runnersCheck] = checks;

    // Determine overall status
    const hasFailed = checks.some(c => c.status === 'fail');
    const hasWarnings = checks.some(c => c.status === 'warn');

    const status: HealthStatus = {
      status: hasFailed ? 'unhealthy' : hasWarnings ? 'degraded' : 'healthy',
      timestamp: new Date().toISOString(),
      uptime: Math.floor((Date.now() - startTime) / 1000),
      version: process.env.npm_package_version || '1.0.0',
      checks: {
        database,
        redis,
        queue,
        triggers: triggersCheck,
        vcs: vcsCheck,
        runners: runnersCheck,
      },
    };

    // Set appropriate HTTP status
    const httpStatus = status.status === 'unhealthy' ? 503 : 200;

    return NextResponse.json(status, { status: httpStatus });
  } catch (error) {
    return NextResponse.json(
      {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        uptime: Math.floor((Date.now() - startTime) / 1000),
        version: process.env.npm_package_version || '1.0.0',
        error: getErrorMessage(error),
      },
      { status: 503 }
    );
  }
}
