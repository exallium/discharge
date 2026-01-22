/**
 * Timeline Event Renderer
 *
 * Dispatches to the appropriate typed component based on event type.
 */

import { TimelineEventMessage } from './timeline-event-message';
import { TimelineEventJob } from './timeline-event-job';
import { TimelineEventPlan } from './timeline-event-plan';
import { TimelineEventPR } from './timeline-event-pr';
import { TimelineEventLabeled } from './timeline-event-labeled';
import { TimelineEventComment } from './timeline-event-comment';
import { TimelineEventGeneric } from './timeline-event-generic';
import type { TimelineEntry } from './build-timeline';

interface TimelineEventRendererProps {
  event: TimelineEntry;
  isLast: boolean;
}

export function TimelineEventRenderer({ event, isLast }: TimelineEventRendererProps) {
  switch (event.type) {
    case 'message':
      // Cast to the specific type expected by the component
      return <TimelineEventMessage event={event as never} isLast={isLast} />;

    case 'job_started':
    case 'job_completed':
    case 'job_failed':
      return <TimelineEventJob event={event as never} isLast={isLast} />;

    case 'plan_created':
    case 'plan_updated':
    case 'plan_approved':
      return <TimelineEventPlan event={event as never} isLast={isLast} />;

    case 'pr_created':
    case 'pr_merged':
      return <TimelineEventPR event={event as never} isLast={isLast} />;

    case 'labeled':
      return <TimelineEventLabeled event={event as never} isLast={isLast} />;

    case 'comment_posted':
      return <TimelineEventComment event={event as never} isLast={isLast} />;

    default:
      return <TimelineEventGeneric event={event} isLast={isLast} />;
  }
}
