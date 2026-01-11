import { Request, Response } from 'express';
import { connection } from './queue';
import { getQueueStats } from './queue';
import { triggers } from './triggers';
import { getAllVCSPlugins } from './vcs';
import { getAllRunners } from './runner';

/**
 * Health check status
 */
export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  version: string;
  checks: {
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
export interface CheckResult {
  status: 'pass' | 'warn' | 'fail';
  message?: string;
  [key: string]: any;
}

/**
 * Readiness check status
 */
export interface ReadinessStatus {
  ready: boolean;
  timestamp: string;
  checks: {
    redis: boolean;
    queue: boolean;
  };
}

const startTime = Date.now();

/**
 * Comprehensive health check endpoint
 * Returns detailed system status including all dependencies
 */
export async function healthCheck(req: Request, res: Response): Promise<void> {
  try {
    const checks = await Promise.all([
      checkRedis(),
      checkQueue(),
      checkTriggers(),
      checkVCS(),
      checkRunners(),
    ]);

    const [redis, queue, triggersCheck, vcsCheck, runnersCheck] = checks;

    // Determine overall status
    const hasFailed = checks.some(c => c.status === 'fail');
    const hasWarnings = checks.some(c => c.status === 'warn');

    const status: HealthStatus = {
      status: hasFailed ? 'unhealthy' : hasWarnings ? 'degraded' : 'healthy',
      timestamp: new Date().toISOString(),
      uptime: Math.floor((Date.now() - startTime) / 1000),
      version: process.env.npm_package_version || '1.0.0',
      checks: {
        redis,
        queue,
        triggers: triggersCheck,
        vcs: vcsCheck,
        runners: runnersCheck,
      },
    };

    // Set appropriate HTTP status
    const httpStatus = status.status === 'unhealthy' ? 503 : 200;

    res.status(httpStatus).json(status);
  } catch (error: any) {
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      uptime: Math.floor((Date.now() - startTime) / 1000),
      version: process.env.npm_package_version || '1.0.0',
      error: error.message,
    });
  }
}

/**
 * Readiness probe endpoint
 * Returns 200 if system is ready to handle requests, 503 otherwise
 * This is used by load balancers to determine if traffic should be routed
 */
export async function readinessCheck(req: Request, res: Response): Promise<void> {
  try {
    const [redisReady, queueReady] = await Promise.all([
      checkRedisConnectivity(),
      checkQueueConnectivity(),
    ]);

    const ready = redisReady && queueReady;

    const status: ReadinessStatus = {
      ready,
      timestamp: new Date().toISOString(),
      checks: {
        redis: redisReady,
        queue: queueReady,
      },
    };

    const httpStatus = ready ? 200 : 503;
    res.status(httpStatus).json(status);
  } catch (error: any) {
    res.status(503).json({
      ready: false,
      timestamp: new Date().toISOString(),
      error: error.message,
    });
  }
}

/**
 * Liveness probe endpoint
 * Returns 200 if process is alive, 503 if it should be restarted
 * This is a simple check that the process is responding
 */
export async function livenessCheck(req: Request, res: Response): Promise<void> {
  res.status(200).json({
    alive: true,
    timestamp: new Date().toISOString(),
    uptime: Math.floor((Date.now() - startTime) / 1000),
  });
}

/**
 * Check Redis connectivity
 */
async function checkRedis(): Promise<CheckResult> {
  try {
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
  } catch (error: any) {
    return {
      status: 'fail',
      message: 'Redis connection failed',
      error: error.message,
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
  } catch (error: any) {
    return {
      status: 'fail',
      message: 'Queue check failed',
      error: error.message,
    };
  }
}

/**
 * Check trigger plugins
 */
async function checkTriggers(): Promise<CheckResult> {
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
async function checkVCS(): Promise<CheckResult> {
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
async function checkRunners(): Promise<CheckResult> {
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
 * Simple Redis connectivity check
 */
async function checkRedisConnectivity(): Promise<boolean> {
  try {
    await connection.ping();
    return true;
  } catch {
    return false;
  }
}

/**
 * Simple queue connectivity check
 */
async function checkQueueConnectivity(): Promise<boolean> {
  try {
    await getQueueStats();
    return true;
  } catch {
    return false;
  }
}
