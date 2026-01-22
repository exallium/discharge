// Force dynamic rendering - page fetches data from database
export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { MessageSquare, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { StatusBadge } from '@/components/ui/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ResourceLinks, extractIssueUrl } from '@/components/ui/resource-links';
import { formatRelativeTime } from '@/lib/utils';
import { projectsRepo, conversationsRepo } from '@/src/db/repositories';
import { ConversationActions } from './conversation-actions';
import { JobsFilters } from './jobs-filters';
import { JobsListLive } from '@/components/jobs-list-live';

interface JobsPageProps {
  searchParams: Promise<{ page?: string; project?: string }>;
}

export default async function JobsPage({ searchParams }: JobsPageProps) {
  const { page: pageParam, project: projectFilter } = await searchParams;
  const page = parseInt(pageParam || '1', 10);
  const limit = 20;
  const offset = (page - 1) * limit;

  const [projects, conversationsData, conversationStats] = await Promise.all([
    projectsRepo.findAll(true),
    conversationsRepo.findAll({ projectId: projectFilter, limit, offset }),
    conversationsRepo.getStats(projectFilter),
  ]);

  const { conversations, total: conversationTotal } = conversationsData;
  const conversationTotalPages = Math.ceil(conversationTotal / limit);

  return (
    <JobsListLive>
      <div className="space-y-6">
        <PageHeader
          title="Activity"
          description="Monitor conversations and job progress"
        />

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          title="Conversations"
          value={conversationStats.total}
          icon={MessageSquare}
          description={`${conversationStats.running} running`}
        />
        <StatCard
          title="Completed"
          value={conversationStats.byStatus.completed || 0}
          icon={CheckCircle2}
        />
        <StatCard
          title="Failed"
          value={conversationStats.byStatus.failed || 0}
          icon={XCircle}
        />
      </div>

      <Card>
        <CardContent className="pt-6">
          {/* Filters */}
          <JobsFilters
            projects={projects.map(p => ({ id: p.id, repoFullName: p.repoFullName }))}
            currentProject={projectFilter}
          />

          {conversations.length === 0 ? (
            <EmptyState
              title="No conversations yet"
              description="Conversations will appear here when triggers fire and processing begins."
            />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Issue</TableHead>
                    <TableHead>Project</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Mode</TableHead>
                    <TableHead>Iterations</TableHead>
                    <TableHead>Last Activity</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {conversations.map((conv) => (
                    <TableRow key={conv.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="min-w-0 flex-1">
                            <Link
                              href={`/jobs/${conv.id}`}
                              className="font-medium hover:underline truncate block"
                            >
                              {(conv.triggerEvent?.title as string)
                                || (conv.externalId.includes('#') || conv.externalId.includes('/') ? conv.externalId : null)
                                || (conv.prNumber ? `PR #${conv.prNumber}` : null)
                                || `Conversation ${conv.id.slice(0, 8)}...`}
                            </Link>
                            <div className="text-xs text-muted-foreground">
                              {conv.triggerType} · {conv.externalId}
                            </div>
                          </div>
                          <ResourceLinks
                            issueUrl={extractIssueUrl(conv.triggerEvent, conv.externalId, conv.triggerType)}
                            prUrl={conv.prUrl}
                            prNumber={conv.prNumber}
                          />
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {conv.projectId}
                      </TableCell>
                      <TableCell>
                        <ConversationStateBadge state={conv.state} />
                      </TableCell>
                      <TableCell>
                        <ConversationStatusBadge status={conv.status} />
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {conv.routeMode.replace('_', ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        {conv.iteration}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatRelativeTime(conv.lastActivityAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <ConversationActions
                          id={conv.id}
                          state={conv.state}
                          externalId={conv.externalId}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/* Pagination */}
              {conversationTotalPages > 1 && (
                <div className="mt-4 flex items-center justify-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    asChild
                  >
                    <Link href={`/jobs?page=${page - 1}${projectFilter ? `&project=${projectFilter}` : ''}`}>
                      Previous
                    </Link>
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    Page {page} of {conversationTotalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= conversationTotalPages}
                    asChild
                  >
                    <Link href={`/jobs?page=${page + 1}${projectFilter ? `&project=${projectFilter}` : ''}`}>
                      Next
                    </Link>
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
      </div>
    </JobsListLive>
  );
}

function ConversationStateBadge({ state }: { state: string }) {
  switch (state) {
    case 'running':
      return (
        <Badge variant="default" className="bg-blue-500">
          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          Running
        </Badge>
      );
    case 'idle':
      return <Badge variant="secondary">Idle</Badge>;
    default:
      return <Badge variant="outline">{state}</Badge>;
  }
}

function ConversationStatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'pending':
      return <Badge variant="outline">Pending</Badge>;
    case 'investigating':
      return <Badge variant="default" className="bg-yellow-500">Investigating</Badge>;
    case 'reviewing':
      return <Badge variant="default" className="bg-purple-500">Reviewing</Badge>;
    case 'executing':
      return <Badge variant="default" className="bg-blue-500">Executing</Badge>;
    case 'completed':
      return <StatusBadge status="success" label="Completed" />;
    case 'failed':
      return <StatusBadge status="error" label="Failed" />;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}
