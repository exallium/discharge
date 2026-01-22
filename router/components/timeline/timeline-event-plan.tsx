/**
 * Timeline Event: Plan
 *
 * Renders plan created, updated, and approved events.
 */

import { FileText, Edit, CheckCircle2, GitPullRequest } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { formatRelativeTime } from '@/lib/utils';
import type {
  PlanCreatedEventData,
  PlanUpdatedEventData,
  PlanApprovedEventData,
} from '@ai-bug-fixer/service-sdk';
import type { TimelineEntry } from './build-timeline';

type PlanEventType = 'plan_created' | 'plan_updated' | 'plan_approved';
type PlanEventData = PlanCreatedEventData | PlanUpdatedEventData | PlanApprovedEventData;

interface TimelineEventPlanProps {
  event: TimelineEntry & { type: PlanEventType; data: PlanEventData };
  isLast: boolean;
}

export function TimelineEventPlan({ event, isLast }: TimelineEventPlanProps) {
  const { type, data, timestamp } = event;

  const getIcon = () => {
    switch (type) {
      case 'plan_created':
        return <FileText className="h-4 w-4 text-purple-500" />;
      case 'plan_updated':
        return <Edit className="h-4 w-4 text-blue-500" />;
      case 'plan_approved':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      default:
        return <FileText className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getTitle = () => {
    switch (type) {
      case 'plan_created':
        return 'Plan Created';
      case 'plan_updated':
        return 'Plan Updated';
      case 'plan_approved':
        return 'Plan Approved';
      default:
        return 'Plan Event';
    }
  };

  const getBadge = () => {
    switch (type) {
      case 'plan_created':
        return <Badge className="bg-purple-500 text-xs">Draft</Badge>;
      case 'plan_updated': {
        const updatedData = data as PlanUpdatedEventData;
        return <Badge variant="outline" className="text-xs">v{updatedData.iteration}</Badge>;
      }
      case 'plan_approved':
        return <Badge className="bg-green-500 text-xs">Approved</Badge>;
      default:
        return null;
    }
  };

  const getBorderColor = () => {
    switch (type) {
      case 'plan_created':
        return 'border-purple-200 dark:border-purple-800';
      case 'plan_updated':
        return 'border-blue-200 dark:border-blue-800';
      case 'plan_approved':
        return 'border-green-200 dark:border-green-800';
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
          {getBadge()}
          <span className="text-sm text-muted-foreground ml-auto">
            {formatRelativeTime(timestamp)}
          </span>
        </div>

        <div className={`p-3 rounded-lg border ${getBorderColor()}`}>
          <div className="text-sm space-y-2">
            {/* Created plan details */}
            {type === 'plan_created' && (
              <>
                {(data as PlanCreatedEventData).prNumber && (
                  <div className="flex items-center gap-1">
                    <GitPullRequest className="h-3 w-3" />
                    <a
                      href={(data as PlanCreatedEventData).prUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                    >
                      PR #{(data as PlanCreatedEventData).prNumber}
                    </a>
                  </div>
                )}
                {(data as PlanCreatedEventData).confidence != null && (
                  <div className="text-muted-foreground">
                    Confidence: {Math.round((data as PlanCreatedEventData).confidence! * 100)}%
                  </div>
                )}
              </>
            )}

            {/* Updated plan details */}
            {type === 'plan_updated' && (data as PlanUpdatedEventData).changesDescription && (
              <div className="text-muted-foreground">
                {(data as PlanUpdatedEventData).changesDescription}
              </div>
            )}

            {/* Approved plan details */}
            {type === 'plan_approved' && (data as PlanApprovedEventData).approver && (
              <div className="text-muted-foreground">
                Approved by {(data as PlanApprovedEventData).approver}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
