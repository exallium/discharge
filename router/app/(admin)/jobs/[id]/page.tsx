// Force dynamic rendering - page fetches data from database
export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ArrowLeft,
  Clock,
  ExternalLink,
  AlertCircle,
  CheckCircle2,
  Loader2,
  FileText,
  Play,
  GitPullRequest,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { TimelineLive, buildTimelineEvents } from '@/components/timeline';
import { formatRelativeTime } from '@/lib/utils';
import { conversationsRepo, jobHistoryRepo } from '@/src/db/repositories';
import { ConversationActions } from '../conversation-actions';

interface ConversationDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function ConversationDetailPage({ params }: ConversationDetailPageProps) {
  const { id } = await params;

  // Fetch conversation data
  const conversation = await conversationsRepo.findById(id);
  if (!conversation) {
    notFound();
  }

  // Fetch related data in parallel
  const [messages, pendingEvents, jobs] = await Promise.all([
    conversationsRepo.getMessages(id),
    conversationsRepo.getPendingEvents(id),
    jobHistoryRepo.findByTrigger(conversation.triggerType, conversation.externalId),
  ]);

  // Build typed timeline events from messages and jobs
  const timelineEvents = buildTimelineEvents(
    messages.map(m => ({
      id: m.id,
      role: m.role,
      content: m.content,
      sourceType: m.sourceType,
      sourceId: m.sourceId,
      sourceAuthor: m.sourceAuthor,
      createdAt: m.createdAt,
    })),
    jobs.map(j => ({
      jobId: j.jobId,
      status: j.status,
      fixed: j.fixed,
      error: j.error,
      prUrl: j.prUrl,
      startedAt: j.startedAt,
      completedAt: j.completedAt,
      createdAt: j.createdAt,
    }))
  );

  // Parse issue URL from trigger event if available
  const triggerLinks = conversation.triggerEvent?.links as Record<string, string> | undefined;
  const issueUrl = triggerLinks?.web;

  // Find the most recent PR URL from jobs
  const latestPrJob = jobs.find(j => j.prUrl);
  const prUrl = latestPrJob?.prUrl;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/jobs">
                <ArrowLeft className="h-4 w-4 mr-1" />
                Back
              </Link>
            </Button>
          </div>
          <PageHeader
            title={conversation.externalId}
            description={`${conversation.triggerType} conversation`}
          />
        </div>
        <div className="flex items-center gap-2">
          {prUrl && (
            <Button variant="default" size="sm" asChild>
              <a href={prUrl} target="_blank" rel="noopener noreferrer">
                <GitPullRequest className="h-4 w-4 mr-1" />
                View PR
              </a>
            </Button>
          )}
          {issueUrl && (
            <Button variant="outline" size="sm" asChild>
              <a href={issueUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4 mr-1" />
                View Issue
              </a>
            </Button>
          )}
          <ConversationActions
            id={conversation.id}
            state={conversation.state}
            externalId={conversation.externalId}
          />
        </div>
      </div>

      {/* Status Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">State</CardTitle>
          </CardHeader>
          <CardContent>
            <StateBadge state={conversation.state} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Status</CardTitle>
          </CardHeader>
          <CardContent>
            <StatusBadge status={conversation.status} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Route Mode</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant="outline">{conversation.routeMode.replace('_', ' ')}</Badge>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Iterations</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{conversation.iteration}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Timeline - Main content */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Timeline</CardTitle>
              <CardDescription>
                Conversation history and job executions
              </CardDescription>
            </CardHeader>
            <CardContent>
              <TimelineLive
                conversationId={conversation.id}
                initialEvents={timelineEvents}
                isRunning={conversation.state === 'running'}
              />
            </CardContent>
          </Card>

          {/* Pending Events */}
          {pendingEvents.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  Pending Events
                </CardTitle>
                <CardDescription>
                  Events waiting to be processed
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {pendingEvents.map((event) => (
                    <div
                      key={event.id}
                      className="flex items-center justify-between p-3 rounded-lg border"
                    >
                      <div>
                        <Badge variant="outline">{event.eventType}</Badge>
                        <span className="ml-2 text-sm text-muted-foreground">
                          Queued {formatRelativeTime(event.queuedAt)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar - Details */}
        <div className="space-y-4">
          {/* Metadata */}
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="text-sm font-medium text-muted-foreground">Conversation ID</div>
                <div className="font-mono text-sm break-all">{conversation.id}</div>
              </div>
              <Separator />
              <div>
                <div className="text-sm font-medium text-muted-foreground">Project</div>
                <div className="text-sm">{conversation.projectId}</div>
              </div>
              <Separator />
              <div>
                <div className="text-sm font-medium text-muted-foreground">Created</div>
                <div className="text-sm">{formatRelativeTime(conversation.createdAt)}</div>
              </div>
              <Separator />
              <div>
                <div className="text-sm font-medium text-muted-foreground">Last Activity</div>
                <div className="text-sm">{formatRelativeTime(conversation.lastActivityAt)}</div>
              </div>
              {conversation.currentJobId && (
                <>
                  <Separator />
                  <div>
                    <div className="text-sm font-medium text-muted-foreground">Current Job</div>
                    <div className="font-mono text-sm">{conversation.currentJobId.slice(0, 8)}...</div>
                  </div>
                </>
              )}
              {conversation.planRef && (
                <>
                  <Separator />
                  <div>
                    <div className="text-sm font-medium text-muted-foreground">Plan Reference</div>
                    <div className="font-mono text-sm break-all">{conversation.planRef}</div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Job History Summary */}
          <Card>
            <CardHeader>
              <CardTitle>Jobs ({jobs.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {jobs.length === 0 ? (
                <div className="text-sm text-muted-foreground">No jobs executed yet</div>
              ) : (
                <div className="space-y-2">
                  {jobs.slice(0, 5).map((job) => (
                    <div
                      key={job.jobId}
                      className="p-2 rounded border text-sm"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <JobStatusIcon status={job.status} />
                          <span className="font-mono">{job.jobId.slice(0, 8)}</span>
                        </div>
                        <span className="text-muted-foreground">
                          {job.startedAt ? formatRelativeTime(job.startedAt) : 'Queued'}
                        </span>
                      </div>
                      {job.prUrl && (
                        <div className="mt-2 pl-6">
                          <a
                            href={job.prUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center text-xs text-primary hover:underline"
                          >
                            <GitPullRequest className="h-3 w-3 mr-1" />
                            View PR
                          </a>
                        </div>
                      )}
                    </div>
                  ))}
                  {jobs.length > 5 && (
                    <div className="text-sm text-muted-foreground text-center pt-2">
                      +{jobs.length - 5} more jobs
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Raw Trigger Event */}
          {conversation.triggerEvent && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  Trigger Event
                </CardTitle>
              </CardHeader>
              <CardContent>
                <details className="group">
                  <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
                    Show raw data
                  </summary>
                  <pre className="mt-2 p-3 rounded bg-muted text-xs overflow-auto max-h-64">
                    {JSON.stringify(conversation.triggerEvent, null, 2)}
                  </pre>
                </details>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function StateBadge({ state }: { state: string }) {
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

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'pending':
      return <Badge variant="outline">Pending</Badge>;
    case 'investigating':
      return <Badge className="bg-yellow-500">Investigating</Badge>;
    case 'reviewing':
      return <Badge className="bg-purple-500">Reviewing</Badge>;
    case 'executing':
      return <Badge className="bg-blue-500">Executing</Badge>;
    case 'completed':
      return <Badge className="bg-green-500">Completed</Badge>;
    case 'failed':
      return <Badge variant="destructive">Failed</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function JobStatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'success':
      return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    case 'failed':
      return <AlertCircle className="h-4 w-4 text-destructive" />;
    case 'running':
      return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
    default:
      return <Play className="h-4 w-4 text-muted-foreground" />;
  }
}

