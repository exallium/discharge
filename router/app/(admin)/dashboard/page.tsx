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
  GitPullRequest,
  MessageSquare,
  Loader2,
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
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { formatRelativeTime } from '@/lib/utils';
import { projectsRepo, jobHistoryRepo, conversationsRepo } from '@/src/db/repositories';

async function getDashboardData() {
  const [projects, jobStats, recentJobs, conversationsData] = await Promise.all([
    projectsRepo.findAll(true),
    jobHistoryRepo.getStats(),
    jobHistoryRepo.findAll({ limit: 10, offset: 0 }),
    conversationsRepo.findAll({ limit: 5 }),
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
    recentConversations: conversationsData.conversations,
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

      {/* Recent Activity - Full Width */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Recent Activity</CardTitle>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/jobs">View all</Link>
          </Button>
        </CardHeader>
        <CardContent>
          {data.recentJobs.length === 0 ? (
            <EmptyState
              title="No activity yet"
              description="Activity will appear here once your triggers fire."
            />
          ) : (
            <div className="space-y-3">
              {data.recentJobs.slice(0, 8).map((job) => (
                <div
                  key={job.jobId}
                  className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <JobStatusIcon status={job.status} fixed={job.fixed} />
                    <div>
                      <div className="font-medium">
                        {job.triggerId}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {job.projectId} &middot; {job.triggerType}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {job.prUrl && (
                      <Button variant="outline" size="sm" asChild>
                        <a href={job.prUrl} target="_blank" rel="noopener noreferrer">
                          <GitPullRequest className="h-4 w-4 mr-1" />
                          View PR
                        </a>
                      </Button>
                    )}
                    <div className="text-sm text-muted-foreground text-right min-w-[80px]">
                      {job.startedAt
                        ? formatRelativeTime(job.startedAt)
                        : 'Queued'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Conversations and Projects */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Active Conversations */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Active Conversations</CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/jobs?tab=conversations">View all</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {data.recentConversations.length === 0 ? (
              <EmptyState
                title="No conversations"
                description="Conversations track multi-turn interactions with issues."
              />
            ) : (
              <div className="space-y-2">
                {data.recentConversations.map((conv) => (
                  <Link
                    key={conv.id}
                    href={`/jobs/${conv.id}`}
                    className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <ConversationStateIcon state={conv.state} />
                      <div>
                        <div className="font-medium text-sm">
                          {conv.externalId}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {conv.triggerType} &middot; {conv.iteration} iterations
                        </div>
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatRelativeTime(conv.lastActivityAt)}
                    </div>
                  </Link>
                ))}
              </div>
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

function JobStatusIcon({ status, fixed }: { status: string; fixed: boolean | null }) {
  if (status === 'success' && fixed) {
    return (
      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-green-100 dark:bg-green-900">
        <Bug className="h-4 w-4 text-green-600 dark:text-green-400" />
      </div>
    );
  }
  if (status === 'success') {
    return (
      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900">
        <History className="h-4 w-4 text-blue-600 dark:text-blue-400" />
      </div>
    );
  }
  if (status === 'failed') {
    return (
      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-red-100 dark:bg-red-900">
        <Bug className="h-4 w-4 text-red-600 dark:text-red-400" />
      </div>
    );
  }
  if (status === 'running') {
    return (
      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-yellow-100 dark:bg-yellow-900">
        <Loader2 className="h-4 w-4 text-yellow-600 dark:text-yellow-400 animate-spin" />
      </div>
    );
  }
  return (
    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-muted">
      <History className="h-4 w-4 text-muted-foreground" />
    </div>
  );
}

function ConversationStateIcon({ state }: { state: string }) {
  if (state === 'running') {
    return (
      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900">
        <Loader2 className="h-4 w-4 text-blue-600 dark:text-blue-400 animate-spin" />
      </div>
    );
  }
  return (
    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-muted">
      <MessageSquare className="h-4 w-4 text-muted-foreground" />
    </div>
  );
}
