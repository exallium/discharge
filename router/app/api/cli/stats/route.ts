/**
 * CLI Stats API
 *
 * GET /api/cli/stats - Queue + project stats
 */

import { NextRequest, NextResponse } from 'next/server';
import { validateApiToken } from '@/src/middleware/api-token';
import { getQueueStats } from '@/src/queue';
import * as jobHistoryRepo from '@/src/db/repositories/job-history';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  // Auth check
  const authError = await validateApiToken(request);
  if (authError) return authError;

  try {
    const projectId = request.nextUrl.searchParams.get('projectId') || undefined;

    const [queueStats, jobStats] = await Promise.all([
      getQueueStats(),
      jobHistoryRepo.getStats(projectId),
    ]);

    return NextResponse.json({
      queue: queueStats,
      jobs: jobStats,
    });
  } catch (error) {
    console.error('Failed to get stats:', error);
    return NextResponse.json(
      { error: 'Failed to get stats' },
      { status: 500 }
    );
  }
}
