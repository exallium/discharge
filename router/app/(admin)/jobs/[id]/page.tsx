// Force dynamic rendering - page fetches data from database
export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ArrowLeft,
  MessageSquare,
  Bot,
  User,
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
import { formatRelativeTime, formatDuration } from '@/lib/utils';
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

  // Build timeline from messages and jobs
  const timeline = buildTimeline(messages, jobs);

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
              {timeline.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No activity yet
                </div>
              ) : (
                <div className="space-y-4">
                  {timeline.map((item, index) => (
                    <TimelineItem key={item.id} item={item} isLast={index === timeline.length - 1} />
                  ))}
                </div>
              )}
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

// Types for timeline
interface TimelineEntry {
  id: string;
  type: 'message' | 'job';
  timestamp: Date;
  data: {
    role?: string;
    content?: string;
    sourceType?: string | null;
    sourceAuthor?: string | null;
    jobId?: string;
    status?: string;
    fixed?: boolean | null;
    duration?: number;
    error?: string | null;
    prUrl?: string | null;
  };
}

function buildTimeline(
  messages: Awaited<ReturnType<typeof conversationsRepo.getMessages>>,
  jobs: Awaited<ReturnType<typeof jobHistoryRepo.findByTrigger>>
): TimelineEntry[] {
  const timeline: TimelineEntry[] = [];

  // Add messages
  for (const msg of messages) {
    timeline.push({
      id: `msg-${msg.id}`,
      type: 'message',
      timestamp: msg.createdAt,
      data: {
        role: msg.role,
        content: msg.content,
        sourceType: msg.sourceType,
        sourceAuthor: msg.sourceAuthor,
      },
    });
  }

  // Add jobs
  for (const job of jobs) {
    const startTime = job.startedAt ? new Date(job.startedAt) : new Date(job.createdAt);
    const endTime = job.completedAt ? new Date(job.completedAt) : undefined;
    const duration = endTime ? endTime.getTime() - startTime.getTime() : undefined;

    timeline.push({
      id: `job-${job.jobId}`,
      type: 'job',
      timestamp: startTime,
      data: {
        jobId: job.jobId,
        status: job.status,
        fixed: job.fixed,
        duration,
        error: job.error,
        prUrl: job.prUrl,
      },
    });
  }

  // Sort by timestamp
  timeline.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  return timeline;
}

function TimelineItem({ item, isLast }: { item: TimelineEntry; isLast: boolean }) {
  return (
    <div className="flex gap-4">
      {/* Timeline line and dot */}
      <div className="flex flex-col items-center">
        <div className="flex items-center justify-center w-8 h-8 rounded-full border-2 bg-background">
          {item.type === 'message' ? (
            item.data.role === 'assistant' ? (
              <Bot className="h-4 w-4 text-primary" />
            ) : item.data.role === 'user' ? (
              <User className="h-4 w-4 text-muted-foreground" />
            ) : (
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
            )
          ) : (
            <JobStatusIcon status={item.data.status || 'pending'} />
          )}
        </div>
        {!isLast && <div className="w-0.5 flex-1 bg-border mt-2" />}
      </div>

      {/* Content */}
      <div className="flex-1 pb-6">
        <div className="flex items-center gap-2 mb-1">
          {item.type === 'message' ? (
            <>
              <span className="font-medium capitalize">{item.data.role}</span>
              {item.data.sourceAuthor && (
                <span className="text-sm text-muted-foreground">
                  ({item.data.sourceAuthor})
                </span>
              )}
            </>
          ) : (
            <>
              <span className="font-medium">Job</span>
              <span className="font-mono text-sm text-muted-foreground">
                {item.data.jobId?.slice(0, 8)}
              </span>
              <JobStatusBadge status={item.data.status || 'pending'} fixed={item.data.fixed} />
            </>
          )}
          <span className="text-sm text-muted-foreground ml-auto">
            {formatRelativeTime(item.timestamp)}
          </span>
        </div>

        {item.type === 'message' && item.data.content && (
          <div className="p-3 rounded-lg bg-muted text-sm whitespace-pre-wrap">
            {item.data.content.length > 500
              ? `${item.data.content.slice(0, 500)}...`
              : item.data.content}
          </div>
        )}

        {item.type === 'job' && (
          <div className="p-3 rounded-lg border text-sm">
            <div className="flex items-center gap-4">
              {item.data.duration && (
                <div className="flex items-center gap-1 text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  {formatDuration(item.data.duration)}
                </div>
              )}
              {item.data.fixed !== null && (
                <div className="flex items-center gap-1">
                  {item.data.fixed ? (
                    <>
                      <CheckCircle2 className="h-3 w-3 text-green-500" />
                      <span className="text-green-600">Fix created</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">No fix</span>
                  )}
                </div>
              )}
            </div>
            {item.data.prUrl && (
              <div className="mt-2">
                <a
                  href={item.data.prUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  <GitPullRequest className="h-3 w-3" />
                  View Pull Request
                </a>
              </div>
            )}
            {item.data.error && (
              <div className="mt-2 p-2 rounded bg-destructive/10 text-destructive text-xs">
                {item.data.error}
              </div>
            )}
          </div>
        )}
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

function JobStatusBadge({ status, fixed }: { status: string; fixed?: boolean | null }) {
  if (status === 'success') {
    return fixed ? (
      <Badge className="bg-green-500 text-xs">Fixed</Badge>
    ) : (
      <Badge variant="secondary" className="text-xs">Analyzed</Badge>
    );
  }
  if (status === 'failed') {
    return <Badge variant="destructive" className="text-xs">Failed</Badge>;
  }
  if (status === 'running') {
    return <Badge className="bg-blue-500 text-xs">Running</Badge>;
  }
  return <Badge variant="outline" className="text-xs">{status}</Badge>;
}
