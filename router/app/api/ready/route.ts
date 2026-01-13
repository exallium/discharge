import { NextResponse } from 'next/server';

// Force dynamic rendering - don't pre-render at build time
export const dynamic = 'force-dynamic';
import { getConnection } from '@/src/queue';
import { isDatabaseInitialized, checkDatabaseHealth } from '@/src/db';
import { getErrorMessage } from '@/src/types/errors';

/**
 * Readiness check status
 */
interface ReadinessStatus {
  ready: boolean;
  timestamp: string;
  checks: {
    database: boolean;
    redis: boolean;
  };
}

/**
 * GET /api/ready - Readiness probe
 * Returns 200 if system is ready to handle requests, 503 otherwise
 */
export async function GET() {
  try {
    const [databaseReady, redisReady] = await Promise.all([
      checkDatabaseConnectivity(),
      checkRedisConnectivity(),
    ]);

    const ready = databaseReady && redisReady;

    const status: ReadinessStatus = {
      ready,
      timestamp: new Date().toISOString(),
      checks: {
        database: databaseReady,
        redis: redisReady,
      },
    };

    const httpStatus = ready ? 200 : 503;
    return NextResponse.json(status, { status: httpStatus });
  } catch (error) {
    return NextResponse.json(
      {
        ready: false,
        timestamp: new Date().toISOString(),
        error: getErrorMessage(error),
      },
      { status: 503 }
    );
  }
}

/**
 * Simple Redis connectivity check
 */
async function checkRedisConnectivity(): Promise<boolean> {
  try {
    const connection = getConnection();
    await connection.ping();
    return true;
  } catch {
    return false;
  }
}

/**
 * Simple database connectivity check
 */
async function checkDatabaseConnectivity(): Promise<boolean> {
  try {
    if (!isDatabaseInitialized()) {
      return false;
    }
    await checkDatabaseHealth();
    return true;
  } catch {
    return false;
  }
}
