/**
 * Timeline Event: Generic
 *
 * Fallback component for unknown event types.
 */

import { Activity } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { formatRelativeTime } from '@/lib/utils';
import type { TimelineEntry } from './build-timeline';

interface TimelineEventGenericProps {
  event: TimelineEntry;
  isLast: boolean;
}

export function TimelineEventGeneric({ event, isLast }: TimelineEventGenericProps) {
  const { type, data, timestamp } = event;

  return (
    <div className="flex gap-4">
      {/* Timeline line and dot */}
      <div className="flex flex-col items-center">
        <div className="flex items-center justify-center w-8 h-8 rounded-full border-2 bg-background">
          <Activity className="h-4 w-4 text-muted-foreground" />
        </div>
        {!isLast && <div className="w-0.5 flex-1 bg-border mt-2" />}
      </div>

      {/* Content */}
      <div className="flex-1 pb-6">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-medium capitalize">{type.replace(/_/g, ' ')}</span>
          <Badge variant="outline" className="text-xs">{type}</Badge>
          <span className="text-sm text-muted-foreground ml-auto">
            {formatRelativeTime(timestamp)}
          </span>
        </div>

        {data && Object.keys(data).length > 0 && (
          <details className="group">
            <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
              Show details
            </summary>
            <pre className="mt-2 p-3 rounded-lg border bg-muted text-xs overflow-auto max-h-48">
              {JSON.stringify(data, null, 2)}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}
