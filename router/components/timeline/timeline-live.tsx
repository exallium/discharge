'use client';

/**
 * Live Timeline Component
 *
 * Wraps the Timeline component with real-time update capability via SSE.
 * Automatically refreshes data when job events are received.
 */

import { useState, useCallback, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Loader2, Bot } from 'lucide-react';
import { Timeline } from './timeline';
import { useConversationEvents, ConversationEvent } from '@/hooks/use-conversation-events';
import type { TimelineEntry } from './build-timeline';

interface TimelineLiveProps {
  /** Conversation ID for SSE subscription */
  conversationId: string;
  /** Initial timeline events (from server) */
  initialEvents: TimelineEntry[];
  /** Whether to enable real-time updates (default: true) */
  enableRealtime?: boolean;
  /** Whether a job is currently running (from server state) */
  isRunning?: boolean;
}

/**
 * Timeline with real-time updates
 */
export function TimelineLive({
  conversationId,
  initialEvents,
  enableRealtime = true,
  isRunning: initialIsRunning = false,
}: TimelineLiveProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [events] = useState(initialEvents);
  const [isRunning, setIsRunning] = useState(initialIsRunning);

  // Refresh the page data when a job completes or fails
  const handleJobComplete = useCallback((_event: ConversationEvent) => {
    setIsRunning(false);
    startTransition(() => {
      router.refresh();
    });
  }, [router]);

  const handleJobStarted = useCallback(() => {
    setIsRunning(true);
  }, []);

  // Subscribe to real-time events
  const { connectionState } = useConversationEvents(conversationId, {
    enabled: enableRealtime,
    onJobComplete: handleJobComplete,
    onJobFailed: handleJobComplete,
    onEvent: (event) => {
      if (event.type === 'job_started') {
        handleJobStarted();
      }
    },
  });

  // Only show alert for persistent connection errors
  const showConnectionError = connectionState === 'error';

  return (
    <div className="relative">
      {/* Connection error alert */}
      {showConnectionError && (
        <div className="mb-4 p-3 rounded-lg border border-yellow-300 bg-yellow-50 dark:bg-yellow-900/10 dark:border-yellow-800">
          <div className="flex items-center gap-2 text-sm text-yellow-800 dark:text-yellow-200">
            <AlertCircle className="h-4 w-4" />
            <span>Live updates unavailable. Refresh the page to see the latest activity.</span>
          </div>
        </div>
      )}

      {/* Timeline content */}
      <Timeline events={events} />

      {/* Running indicator at bottom of timeline */}
      {isRunning && (
        <div className="flex gap-4 mt-4">
          <div className="flex flex-col items-center">
            <div className="flex items-center justify-center w-8 h-8 rounded-full border-2 border-blue-300 bg-blue-50 dark:bg-blue-900/20">
              <Bot className="h-4 w-4 text-blue-500" />
            </div>
          </div>
          <div className="flex-1 pb-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>Working on it...</span>
            </div>
          </div>
        </div>
      )}

      {/* Loading overlay when refreshing */}
      {isPending && (
        <div className="absolute inset-0 bg-background/50 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  );
}
