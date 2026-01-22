/**
 * Timeline Event: Message
 *
 * Renders user, assistant, or system messages in the timeline.
 */

import { Bot, User, MessageSquare } from 'lucide-react';
import { formatRelativeTime } from '@/lib/utils';
import type { MessageEventData } from '@ai-bug-fixer/service-sdk';
import type { TimelineEntry } from './build-timeline';

interface TimelineEventMessageProps {
  event: TimelineEntry & { type: 'message'; data: MessageEventData };
  isLast: boolean;
}

export function TimelineEventMessage({ event, isLast }: TimelineEventMessageProps) {
  const { data, timestamp } = event;
  const roleData = data as MessageEventData;

  const getIcon = () => {
    switch (roleData.role) {
      case 'assistant':
        return <Bot className="h-4 w-4 text-primary" />;
      case 'user':
        return <User className="h-4 w-4 text-muted-foreground" />;
      default:
        return <MessageSquare className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getBackgroundColor = () => {
    switch (roleData.role) {
      case 'assistant':
        return 'bg-primary/5 border-primary/20';
      case 'system':
        return 'bg-yellow-50 border-yellow-200 dark:bg-yellow-900/10 dark:border-yellow-800';
      default:
        return 'bg-muted';
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
          <span className="font-medium capitalize">{roleData.role}</span>
          {roleData.sourceAuthor && (
            <span className="text-sm text-muted-foreground">
              ({roleData.sourceAuthor})
            </span>
          )}
          {roleData.sourceType && (
            <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
              {roleData.sourceType}
            </span>
          )}
          <span className="text-sm text-muted-foreground ml-auto">
            {formatRelativeTime(timestamp)}
          </span>
        </div>

        {roleData.content && (
          <div className={`p-3 rounded-lg border text-sm whitespace-pre-wrap ${getBackgroundColor()}`}>
            {roleData.content.length > 1000
              ? `${roleData.content.slice(0, 1000)}...`
              : roleData.content}
          </div>
        )}
      </div>
    </div>
  );
}
