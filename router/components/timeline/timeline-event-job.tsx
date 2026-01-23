/**
 * Timeline Event: Job
 *
 * Renders job started, completed, and failed events.
 */

import { Play, CheckCircle2, XCircle, Loader2, Clock, GitPullRequest } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { formatRelativeTime, formatDuration } from '@/lib/utils';
import type {
  JobStartedEventData,
  JobCompletedEventData,
  JobFailedEventData,
} from '@discharge/service-sdk';
import type { TimelineEntry } from './build-timeline';

type JobEventType = 'job_started' | 'job_completed' | 'job_failed';
type JobEventData = JobStartedEventData | JobCompletedEventData | JobFailedEventData;

interface TimelineEventJobProps {
  event: TimelineEntry & { type: JobEventType; data: JobEventData };
  isLast: boolean;
}

export function TimelineEventJob({ event, isLast }: TimelineEventJobProps) {
  const { type, data, timestamp } = event;

  const getIcon = () => {
    switch (type) {
      case 'job_started':
        return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
      case 'job_completed':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'job_failed':
        return <XCircle className="h-4 w-4 text-destructive" />;
      default:
        return <Play className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getBorderColor = () => {
    switch (type) {
      case 'job_started':
        return 'border-blue-200 dark:border-blue-800';
      case 'job_completed':
        return 'border-green-200 dark:border-green-800';
      case 'job_failed':
        return 'border-destructive/50';
      default:
        return 'border-border';
    }
  };

  const getStatusBadge = () => {
    switch (type) {
      case 'job_started':
        return <Badge className="bg-blue-500 text-xs">Running</Badge>;
      case 'job_completed': {
        const completedData = data as JobCompletedEventData;
        return completedData.fixed ? (
          <Badge className="bg-green-500 text-xs">Fixed</Badge>
        ) : (
          <Badge variant="secondary" className="text-xs">Analyzed</Badge>
        );
      }
      case 'job_failed':
        return <Badge variant="destructive" className="text-xs">Failed</Badge>;
      default:
        return null;
    }
  };

  return (
    <div className="flex gap-4">
      {/* Timeline line and dot */}
      <div className="flex flex-col items-center">
        <div className="flex items-center justify-center w-8 h-8 rounded-full border-2 bg-background">
          {getIcon()}
        </div>
        {!isLast && <div className="w-0.5 flex-1 bg-border mt-2" />}
      </div>

      {/* Content */}
      <div className="flex-1 pb-6">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-medium">Job</span>
          <span className="font-mono text-sm text-muted-foreground">
            {data.jobId.slice(0, 8)}
          </span>
          {getStatusBadge()}
          <span className="text-sm text-muted-foreground ml-auto">
            {formatRelativeTime(timestamp)}
          </span>
        </div>

        {/* Only render content box for completed/failed events - job_started just shows header */}
        {(type === 'job_completed' || type === 'job_failed') && (
          <div className={`p-3 rounded-lg border ${getBorderColor()}`}>
            <div className="flex flex-wrap items-center gap-4 text-sm">
              {/* Duration */}
              {((data as JobCompletedEventData | JobFailedEventData).durationMs != null) && (
                <div className="flex items-center gap-1 text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  {formatDuration((data as JobCompletedEventData | JobFailedEventData).durationMs!)}
                </div>
              )}

              {/* Fix status for completed jobs */}
              {type === 'job_completed' && (
                <div className="flex items-center gap-1">
                  {(data as JobCompletedEventData).fixed ? (
                    <>
                      <CheckCircle2 className="h-3 w-3 text-green-500" />
                      <span className="text-green-600">Fix created</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">No fix needed</span>
                  )}
                </div>
              )}
            </div>

            {/* PR Link */}
            {type === 'job_completed' && (data as JobCompletedEventData).prUrl && (
              <div className="mt-2">
                <a
                  href={(data as JobCompletedEventData).prUrl!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-primary hover:underline text-sm"
                >
                  <GitPullRequest className="h-3 w-3" />
                  View Pull Request
                </a>
              </div>
            )}

            {/* Error for failed jobs */}
            {type === 'job_failed' && (data as JobFailedEventData).error && (
              <div className="mt-2 p-2 rounded bg-destructive/10 text-destructive text-xs">
                {(data as JobFailedEventData).error}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
