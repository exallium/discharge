/**
 * CLI Job Detail API
 *
 * GET /api/cli/jobs/[jobId] - Get single job status + branch name
 */

import { NextRequest, NextResponse } from 'next/server';
import { validateApiToken } from '@/src/middleware/api-token';
import * as jobHistoryRepo from '@/src/db/repositories/job-history';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  // Auth check
  const authError = await validateApiToken(request);
  if (authError) return authError;

  try {
    const { jobId } = await params;
    const job = await jobHistoryRepo.findByJobId(jobId);

    if (!job) {
      return NextResponse.json(
        { error: `Job not found: ${jobId}` },
        { status: 404 }
      );
    }

    return NextResponse.json({ job });
  } catch (error) {
    console.error('Failed to get job:', error);
    return NextResponse.json(
      { error: 'Failed to get job' },
      { status: 500 }
    );
  }
}
