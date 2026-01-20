import { NextRequest, NextResponse } from 'next/server';
import { apiLogsRepo } from '@/src/db/repositories';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/logs/[id]
 * Get log details by ID - returns only the detail fields for lazy loading
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  try {
    const details = await apiLogsRepo.findById(id);
    if (!details) {
      return NextResponse.json(
        { error: 'Log not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(details);
  } catch (error) {
    console.error('Failed to get log details:', error);
    return NextResponse.json(
      { error: 'Failed to get log details' },
      { status: 500 }
    );
  }
}
