import { NextRequest, NextResponse } from 'next/server';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

import { apiLogsRepo } from '@/src/db/repositories';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;

    // Parse filters from query params
    const filters: {
      search?: string;
      triggerId?: string;
      eventType?: string;
      statusCode?: number;
      statusCodeMin?: number;
      statusCodeMax?: number;
    } = {};

    const search = searchParams.get('search');
    if (search) filters.search = search;

    const triggerId = searchParams.get('triggerId');
    if (triggerId) filters.triggerId = triggerId;

    const eventType = searchParams.get('eventType');
    if (eventType) filters.eventType = eventType;

    const statusCode = searchParams.get('statusCode');
    if (statusCode) filters.statusCode = parseInt(statusCode, 10);

    const statusCodeMin = searchParams.get('statusCodeMin');
    if (statusCodeMin) filters.statusCodeMin = parseInt(statusCodeMin, 10);

    const statusCodeMax = searchParams.get('statusCodeMax');
    if (statusCodeMax) filters.statusCodeMax = parseInt(statusCodeMax, 10);

    // Parse pagination
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    // Fetch data in parallel
    const [logs, stats, total] = await Promise.all([
      apiLogsRepo.find(filters, { limit, offset }),
      apiLogsRepo.getStats(),
      apiLogsRepo.count(filters),
    ]);

    return NextResponse.json({
      logs,
      stats,
      total,
      pagination: {
        limit,
        offset,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Failed to fetch logs:', error);
    return NextResponse.json(
      { error: 'Failed to fetch logs' },
      { status: 500 }
    );
  }
}
