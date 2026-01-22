/**
 * Timeline Event: Labeled
 *
 * Renders label added events (e.g., plan-approved label).
 */

import { Tag } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { formatRelativeTime } from '@/lib/utils';
import type { LabeledEventData } from '@ai-bug-fixer/service-sdk';
import type { TimelineEntry } from './build-timeline';

interface TimelineEventLabeledProps {
  event: TimelineEntry & { type: 'labeled'; data: LabeledEventData };
  isLast: boolean;
}

export function TimelineEventLabeled({ event, isLast }: TimelineEventLabeledProps) {
  const { data, timestamp } = event;
  const labelData = data as LabeledEventData;

  const getLabelColor = () => {
    // Special colors for known labels
    if (labelData.label === 'plan-approved') {
      return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
    }
    if (labelData.label === 'needs-review') {
      return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
    }
    if (labelData.label === 'bug') {
      return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
    }
    // Default
    return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200';
  };

  return (
    <div className="flex gap-4">
      {/* Timeline line and dot */}
      <div className="flex flex-col items-center">
        <div className="flex items-center justify-center w-8 h-8 rounded-full border-2 bg-background">
          <Tag className="h-4 w-4 text-muted-foreground" />
        </div>
        {!isLast && <div className="w-0.5 flex-1 bg-border mt-2" />}
      </div>

      {/* Content */}
      <div className="flex-1 pb-6">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-medium">Label Added</span>
          <Badge className={`${getLabelColor()} text-xs`}>
            {labelData.label}
          </Badge>
          <span className="text-sm text-muted-foreground ml-auto">
            {formatRelativeTime(timestamp)}
          </span>
        </div>

        {labelData.addedBy && (
          <div className="text-sm text-muted-foreground">
            Added by {labelData.addedBy}
          </div>
        )}
      </div>
    </div>
  );
}
