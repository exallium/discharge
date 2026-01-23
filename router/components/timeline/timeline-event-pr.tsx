/**
 * Timeline Event: PR
 *
 * Renders PR created and merged events.
 */

import { GitPullRequest, GitMerge } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { formatRelativeTime } from '@/lib/utils';
import type { PRCreatedEventData, PRMergedEventData } from '@discharge/service-sdk';
import type { TimelineEntry } from './build-timeline';

type PREventType = 'pr_created' | 'pr_merged';
type PREventData = PRCreatedEventData | PRMergedEventData;

interface TimelineEventPRProps {
  event: TimelineEntry & { type: PREventType; data: PREventData };
  isLast: boolean;
}

export function TimelineEventPR({ event, isLast }: TimelineEventPRProps) {
  const { type, data, timestamp } = event;

  const getIcon = () => {
    switch (type) {
      case 'pr_created':
        return <GitPullRequest className="h-4 w-4 text-green-500" />;
      case 'pr_merged':
        return <GitMerge className="h-4 w-4 text-purple-500" />;
      default:
        return <GitPullRequest className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getTitle = () => {
    switch (type) {
      case 'pr_created':
        return 'Pull Request Created';
      case 'pr_merged':
        return 'Pull Request Merged';
      default:
        return 'PR Event';
    }
  };

  const getBadge = () => {
    switch (type) {
      case 'pr_created':
        return <Badge className="bg-green-500 text-xs">Open</Badge>;
      case 'pr_merged':
        return <Badge className="bg-purple-500 text-xs">Merged</Badge>;
      default:
        return null;
    }
  };

  const getBorderColor = () => {
    switch (type) {
      case 'pr_created':
        return 'border-green-200 dark:border-green-800';
      case 'pr_merged':
        return 'border-purple-200 dark:border-purple-800';
      default:
        return 'border-border';
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
          <span className="font-medium">{getTitle()}</span>
          <span className="text-muted-foreground">#{data.prNumber}</span>
          {getBadge()}
          <span className="text-sm text-muted-foreground ml-auto">
            {formatRelativeTime(timestamp)}
          </span>
        </div>

        <div className={`p-3 rounded-lg border ${getBorderColor()}`}>
          <div className="text-sm space-y-2">
            <a
              href={data.prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline font-medium"
            >
              {type === 'pr_created'
                ? (data as PRCreatedEventData).title
                : `View PR #${data.prNumber}`}
            </a>

            {type === 'pr_created' && (data as PRCreatedEventData).branchName && (
              <div className="text-muted-foreground font-mono text-xs">
                Branch: {(data as PRCreatedEventData).branchName}
              </div>
            )}

            {type === 'pr_merged' && (data as PRMergedEventData).mergedBy && (
              <div className="text-muted-foreground">
                Merged by {(data as PRMergedEventData).mergedBy}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
