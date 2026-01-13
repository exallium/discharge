import { NextResponse } from 'next/server';

const startTime = Date.now();

/**
 * GET /api/live - Liveness probe
 * Returns 200 if process is alive, 503 if it should be restarted
 * This is a simple check that the process is responding
 */
export async function GET() {
  return NextResponse.json({
    alive: true,
    timestamp: new Date().toISOString(),
    uptime: Math.floor((Date.now() - startTime) / 1000),
  });
}
