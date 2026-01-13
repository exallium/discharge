// Force dynamic rendering - page fetches data from database
export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { History, Bug, CheckCircle2, XCircle } from 'lucide-react';
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
import { formatRelativeTime, formatDuration } from '@/lib/utils';
import { jobHistoryRepo, projectsRepo } from '@/src/db/repositories';

interface JobsPageProps {
  searchParams: Promise<{ page?: string; project?: string }>;
}

export default async function JobsPage({ searchParams }: JobsPageProps) {
  const { page: pageParam, project: projectFilter } = await searchParams;
  const page = parseInt(pageParam || '1', 10);
  const limit = 20;
  const offset = (page - 1) * limit;

  const [allJobs, stats, projects] = await Promise.all([
    jobHistoryRepo.findAll({ limit: 1000 }), // Fetch more to filter client-side
    jobHistoryRepo.getStats(),
    projectsRepo.findAll(true),
  ]);

  // Filter by project if specified (client-side filtering for now)
  const filteredJobs = projectFilter
    ? allJobs.filter((job) => job.projectId === projectFilter)
    : allJobs;

  // Apply pagination
  const jobs = filteredJobs.slice(offset, offset + limit);

  const totalPages = Math.ceil(filteredJobs.length / limit);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Jobs"
        description="View job history and status"
      />

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <StatCard
          title="Total Jobs"
          value={stats.total || 0}
          icon={History}
        />
        <StatCard
          title="Completed"
          value={(stats.total || 0) - (stats.failed || 0)}
          icon={CheckCircle2}
        />
        <StatCard
          title="Bugs Fixed"
          value={stats.fixedCount || 0}
          icon={Bug}
        />
        <StatCard
          title="Failed"
          value={stats.failed || 0}
          icon={XCircle}
        />
      </div>

      <Card>
        <CardContent className="pt-6">
          {/* Filters */}
          <div className="mb-4 flex items-center gap-4">
            <select
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              defaultValue={projectFilter || ''}
            >
              <option value="">All projects</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.repoFullName}
                </option>
              ))}
            </select>
          </div>

          {jobs.length === 0 ? (
            <EmptyState
              title="No jobs yet"
              description="Jobs will appear here when your triggers fire and processing begins."
            />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Job ID</TableHead>
                    <TableHead>Project</TableHead>
                    <TableHead>Trigger</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Started</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jobs.map((job) => (
                    <TableRow key={job.jobId}>
                      <TableCell className="font-mono text-sm">
                        {job.jobId.slice(0, 8)}...
                      </TableCell>
                      <TableCell>{job.projectId}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{job.triggerType}</Badge>
                      </TableCell>
                      <TableCell>
                        <JobStatusBadge status={job.status} fixed={job.fixed} />
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {job.startedAt && job.completedAt
                          ? formatDuration(
                              new Date(job.completedAt).getTime() -
                                new Date(job.startedAt).getTime()
                            )
                          : '-'}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {job.startedAt
                          ? formatRelativeTime(job.startedAt)
                          : 'Queued'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="mt-4 flex items-center justify-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    asChild
                  >
                    <Link href={`/jobs?page=${page - 1}`}>Previous</Link>
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    Page {page} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages}
                    asChild
                  >
                    <Link href={`/jobs?page=${page + 1}`}>Next</Link>
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function JobStatusBadge({
  status,
  fixed,
}: {
  status: string;
  fixed: boolean | null;
}) {
  if (status === 'success') {
    return fixed ? (
      <StatusBadge status="success" label="Fixed" />
    ) : (
      <Badge variant="secondary">Analyzed</Badge>
    );
  }
  if (status === 'failed') {
    return <StatusBadge status="error" label="Failed" />;
  }
  if (status === 'running') {
    return <StatusBadge status="running" />;
  }
  return <Badge variant="outline">{status}</Badge>;
}
