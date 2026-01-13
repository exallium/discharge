// Force dynamic rendering - page fetches data from database
export const dynamic = 'force-dynamic';

import Link from 'next/link';
import {
  FolderKanban,
  History,
  Bug,
  TrendingUp,
  Plus,
  Settings,
  Download,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
import { EmptyState } from '@/components/ui/empty-state';
import { formatRelativeTime } from '@/lib/utils';
import { projectsRepo, jobHistoryRepo } from '@/src/db/repositories';

async function getDashboardData() {
  const [projects, jobStats, recentJobs] = await Promise.all([
    projectsRepo.findAll(true),
    jobHistoryRepo.getStats(),
    jobHistoryRepo.findAll({ limit: 5, offset: 0 }),
  ]);

  const activeProjects = projects.filter((p) => p.enabled).length;
  const successRate =
    jobStats.total && jobStats.total > 0
      ? Math.round(((jobStats.fixedCount || 0) / jobStats.total) * 100)
      : 0;

  return {
    activeProjects,
    totalJobs: jobStats.total || 0,
    bugsFixed: jobStats.fixedCount || 0,
    successRate,
    recentJobs,
    projects: projects.slice(0, 5),
  };
}

export default async function DashboardPage() {
  const data = await getDashboardData();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Overview of your AI Bug Fixer system"
      />

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Active Projects"
          value={data.activeProjects}
          icon={FolderKanban}
        />
        <StatCard
          title="Total Jobs"
          value={data.totalJobs}
          icon={History}
        />
        <StatCard
          title="Bugs Fixed"
          value={data.bugsFixed}
          icon={Bug}
        />
        <StatCard
          title="Success Rate"
          value={`${data.successRate}%`}
          icon={TrendingUp}
        />
      </div>

      {/* Recent Jobs and Projects */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Recent Jobs */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Recent Jobs</CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/jobs">View all</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {data.recentJobs.length === 0 ? (
              <EmptyState
                title="No jobs yet"
                description="Jobs will appear here once your triggers fire."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Project</TableHead>
                    <TableHead>Trigger</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.recentJobs.map((job) => (
                    <TableRow key={job.jobId}>
                      <TableCell className="font-mono text-sm">
                        {job.projectId}
                      </TableCell>
                      <TableCell>{job.triggerType}</TableCell>
                      <TableCell>
                        <JobStatusBadge status={job.status} fixed={job.fixed} />
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
            )}
          </CardContent>
        </Card>

        {/* Projects */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Projects</CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/projects">Manage</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {data.projects.length === 0 ? (
              <EmptyState
                title="No projects yet"
                description="Add your first repository to start fixing bugs."
                action={{
                  label: 'Add Project',
                  href: '/projects/new',
                }}
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Repository</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.projects.map((project) => (
                    <TableRow key={project.id}>
                      <TableCell>
                        <Link
                          href={`/projects/${project.id}`}
                          className="hover:underline"
                        >
                          {project.repoFullName}
                        </Link>
                      </TableCell>
                      <TableCell>
                        {project.enabled ? (
                          <Badge variant="success">Active</Badge>
                        ) : (
                          <Badge variant="secondary">Disabled</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            <Button asChild>
              <Link href="/projects/new">
                <Plus className="mr-2 h-4 w-4" />
                Add Project
              </Link>
            </Button>
            <Button variant="secondary" asChild>
              <Link href="/settings">
                <Settings className="mr-2 h-4 w-4" />
                Configure Settings
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/api/export/all">
                <Download className="mr-2 h-4 w-4" />
                Export Backup
              </Link>
            </Button>
          </div>
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
