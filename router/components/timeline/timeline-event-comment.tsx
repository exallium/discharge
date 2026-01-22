/**
 * Timeline Event: Comment Posted
 *
 * Renders comment posted back to issue/PR events.
 */

import { MessageSquare } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { formatRelativeTime } from '@/lib/utils';
import type { CommentPostedEventData } from '@ai-bug-fixer/service-sdk';
import type { TimelineEntry } from './build-timeline';

interface TimelineEventCommentProps {
  event: TimelineEntry & { type: 'comment_posted'; data: CommentPostedEventData };
  isLast: boolean;
}

export function TimelineEventComment({ event, isLast }: TimelineEventCommentProps) {
  const { data, timestamp } = event;
  const commentData = data as CommentPostedEventData;

  return (
    <div className="flex gap-4">
      {/* Timeline line and dot */}
      <div className="flex flex-col items-center">
        <div className="flex items-center justify-center w-8 h-8 rounded-full border-2 bg-background">
          <MessageSquare className="h-4 w-4 text-blue-500" />
        </div>
        {!isLast && <div className="w-0.5 flex-1 bg-border mt-2" />}
      </div>

      {/* Content */}
      <div className="flex-1 pb-6">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-medium">Comment Posted</span>
          <Badge variant="outline" className="text-xs">
            {commentData.targetType === 'pr' ? 'PR' : 'Issue'} #{commentData.targetNumber}
          </Badge>
          <span className="text-sm text-muted-foreground ml-auto">
            {formatRelativeTime(timestamp)}
          </span>
        </div>

        {commentData.body && (
          <div className="p-3 rounded-lg border bg-blue-50 border-blue-200 dark:bg-blue-900/10 dark:border-blue-800 text-sm whitespace-pre-wrap">
            {commentData.body.length > 500
              ? `${commentData.body.slice(0, 500)}...`
              : commentData.body}
          </div>
        )}
      </div>
    </div>
  );
}
