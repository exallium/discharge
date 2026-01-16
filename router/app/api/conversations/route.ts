import { NextRequest, NextResponse } from 'next/server';
import { conversationsRepo } from '@/src/db/repositories';

export const dynamic = 'force-dynamic';

/**
 * GET /api/conversations
 * List all conversations with optional filtering
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get('project') || undefined;
  const state = searchParams.get('state') as 'idle' | 'running' | undefined;
  const page = parseInt(searchParams.get('page') || '1', 10);
  const limit = parseInt(searchParams.get('limit') || '50', 10);
  const offset = (page - 1) * limit;

  try {
    const { conversations, total } = await conversationsRepo.findAll({
      projectId,
      state,
      limit,
      offset,
    });

    const stats = await conversationsRepo.getStats(projectId);

    return NextResponse.json({
      conversations,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      stats,
    });
  } catch (error) {
    console.error('Failed to list conversations:', error);
    return NextResponse.json(
      { error: 'Failed to list conversations' },
      { status: 500 }
    );
  }
}
