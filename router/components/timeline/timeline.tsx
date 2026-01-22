/**
 * Timeline Container Component
 *
 * Renders a vertical timeline with connected events.
 */

import { TimelineEventRenderer } from './timeline-event-renderer';
import type { TimelineEntry } from './build-timeline';

interface TimelineProps {
  events: TimelineEntry[];
  className?: string;
}

export function Timeline({ events, className = '' }: TimelineProps) {
  if (events.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No activity yet
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${className}`}>
      {events.map((event, index) => (
        <TimelineEventRenderer
          key={event.id}
          event={event}
          isLast={index === events.length - 1}
        />
      ))}
    </div>
  );
}
