'use client';

import { useState, Fragment } from 'react';
import { ChevronRight, ChevronDown, Copy, Check, ExternalLink, Loader2 } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatRelativeTime } from '@/lib/utils';

/**
 * Details stored for expandable log view
 */
interface LogDetails {
  validationResult?: { valid: boolean; reason?: string };
  parseResult?: { success: boolean; reason?: string };
  filterResult?: { processed: boolean; reason?: string };
  queueResult?: { jobId?: string; error?: string; conversationId?: string; action?: string };
  eventInfo?: Record<string, unknown>;
  responseBody?: Record<string, unknown>;
  error?: { message?: string; stack?: string };
  [key: string]: unknown;
}

/**
 * Loaded details from API
 */
interface LoadedDetails {
  details: LogDetails | null;
  payloadSummary: Record<string, unknown> | null;
  error: string | null;
  outcomeReason: string | null;
  userAgent: string | null;
}

/**
 * Log entry for display in the table - detail fields are optional (lazy loaded)
 */
interface LogEntry {
  id: string;
  requestId: string;
  method: string;
  path: string;
  statusCode: number;
  responseTimeMs: number;
  ipAddress: string | null;
  userAgent?: string | null;
  triggerId: string | null;
  eventType: string | null;
  payloadSummary?: Record<string, unknown> | null;
  outcome: string | null;
  outcomeReason?: string | null;
  jobId: string | null;
  projectId: string | null;
  details?: LogDetails | null;
  error?: string | null;
  createdAt: Date;
}

interface LogsTableProps {
  logs: LogEntry[];
}

export function LogsTable({ logs }: LogsTableProps) {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [loadedDetails, setLoadedDetails] = useState<Record<string, LoadedDetails>>({});
  const [loadingDetails, setLoadingDetails] = useState<Set<string>>(new Set());

  const fetchDetails = async (logId: string) => {
    // Skip if already loaded or loading
    if (loadedDetails[logId] || loadingDetails.has(logId)) {
      return;
    }

    setLoadingDetails((prev) => new Set(prev).add(logId));

    try {
      const response = await fetch(`/api/logs/${logId}`);
      if (response.ok) {
        const data = await response.json();
        setLoadedDetails((prev) => ({
          ...prev,
          [logId]: data,
        }));
      }
    } catch (error) {
      console.error('Failed to fetch log details:', error);
    } finally {
      setLoadingDetails((prev) => {
        const next = new Set(prev);
        next.delete(logId);
        return next;
      });
    }
  };

  const toggleRow = (id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
        // Fetch details on expand
        fetchDetails(id);
      }
      return next;
    });
  };

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-8"></TableHead>
          <TableHead>Timestamp</TableHead>
          <TableHead>Request ID</TableHead>
          <TableHead>Method</TableHead>
          <TableHead>Path</TableHead>
          <TableHead>Outcome</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Time</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {logs.map((log) => {
          const isExpanded = expandedRows.has(log.id);
          const isLoading = loadingDetails.has(log.id);
          const details = loadedDetails[log.id];

          return (
            <Fragment key={log.id}>
              <TableRow
                className="cursor-pointer hover:bg-muted/50"
                onClick={() => toggleRow(log.id)}
              >
                <TableCell className="w-8">
                  <Button variant="ghost" size="icon" className="h-6 w-6">
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </Button>
                </TableCell>
                <TableCell className="text-muted-foreground text-sm whitespace-nowrap">
                  {formatRelativeTime(log.createdAt)}
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {log.requestId?.slice(0, 12) || '-'}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{log.method}</Badge>
                </TableCell>
                <TableCell className="font-mono text-sm max-w-xs truncate" title={log.path}>
                  {log.path}
                </TableCell>
                <TableCell>
                  <OutcomeBadge outcome={log.outcome} />
                </TableCell>
                <TableCell>
                  <StatusCodeBadge statusCode={log.statusCode} />
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {log.responseTimeMs}ms
                </TableCell>
              </TableRow>

              {/* Expanded details row */}
              {isExpanded && (
                <TableRow>
                  <TableCell colSpan={8} className="bg-muted/30 p-0">
                    {isLoading ? (
                      <div className="p-8 flex items-center justify-center">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                      </div>
                    ) : details ? (
                      <LogDetailsPanel log={log} loadedDetails={details} />
                    ) : (
                      <div className="p-8 flex items-center justify-center text-muted-foreground">
                        No details available
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              )}
            </Fragment>
          );
        })}
      </TableBody>
    </Table>
  );
}

function LogDetailsPanel({ log, loadedDetails }: { log: LogEntry; loadedDetails: LoadedDetails }) {
  const [copied, setCopied] = useState<string | null>(null);

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  const { details, payloadSummary, error, outcomeReason } = loadedDetails;

  return (
    <div className="p-4 space-y-4">
      {/* Summary row */}
      <div className="flex flex-wrap gap-4 text-sm">
        {log.requestId && (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Request ID:</span>
            <code className="bg-muted px-2 py-0.5 rounded text-xs">{log.requestId}</code>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => copyToClipboard(log.requestId, 'requestId')}
            >
              {copied === 'requestId' ? (
                <Check className="h-3 w-3 text-green-500" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
            </Button>
          </div>
        )}
        {log.triggerId && (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Trigger:</span>
            <Badge variant="secondary">{log.triggerId}</Badge>
          </div>
        )}
        {log.eventType && (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Event:</span>
            <Badge variant="outline">{log.eventType}</Badge>
          </div>
        )}
        {log.projectId && (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Project:</span>
            <a
              href={`/projects/${log.projectId}`}
              className="text-primary hover:underline flex items-center gap-1"
              onClick={(e) => e.stopPropagation()}
            >
              {log.projectId}
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        )}
        {log.jobId && (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Job ID:</span>
            <code className="bg-muted px-2 py-0.5 rounded text-xs">{log.jobId}</code>
          </div>
        )}
      </div>

      {/* Outcome reason */}
      {outcomeReason ? (
        <div className="bg-background rounded-md border p-3">
          <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
            Outcome Reason
          </div>
          <div className="text-sm">{String(outcomeReason)}</div>
        </div>
      ) : null}

      {/* Pipeline details */}
      {details && (
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground uppercase tracking-wide">
            Pipeline Details
          </div>
          <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
            {details.validationResult && (
              <DetailCard
                title="Validation"
                success={details.validationResult.valid}
                reason={details.validationResult.reason}
              />
            )}
            {details.parseResult && (
              <DetailCard
                title="Parse"
                success={details.parseResult.success}
                reason={details.parseResult.reason}
              />
            )}
            {details.filterResult && (
              <DetailCard
                title="Filter"
                success={details.filterResult.processed}
                reason={details.filterResult.reason}
              />
            )}
            {details.queueResult && (
              <DetailCard
                title="Queue"
                success={!!details.queueResult.jobId}
                reason={details.queueResult.error || (details.queueResult.jobId ? `Job: ${details.queueResult.jobId}` : undefined)}
              />
            )}
          </div>
        </div>
      )}

      {/* Additional details as JSON */}
      {details && (details.eventInfo || details.responseBody || details.error) && (
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground uppercase tracking-wide">
            Additional Data
          </div>
          <pre className="bg-muted/50 rounded-md p-3 text-xs overflow-auto max-h-64 font-mono">
            {JSON.stringify(
              {
                ...(details.eventInfo && { eventInfo: details.eventInfo }),
                ...(details.responseBody && { responseBody: details.responseBody }),
                ...(details.error && { error: details.error }),
              },
              null,
              2
            )}
          </pre>
        </div>
      )}

      {/* Payload summary */}
      {payloadSummary && Object.keys(payloadSummary).length > 0 && (
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground uppercase tracking-wide">
            Payload Summary
          </div>
          <pre className="bg-muted/50 rounded-md p-3 text-xs overflow-auto max-h-32 font-mono">
            {JSON.stringify(payloadSummary, null, 2)}
          </pre>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 rounded-md border border-red-200 dark:border-red-800 p-3">
          <div className="text-xs text-red-600 dark:text-red-400 uppercase tracking-wide mb-1">
            Error
          </div>
          <div className="text-sm text-red-800 dark:text-red-200">{error}</div>
        </div>
      )}
    </div>
  );
}

function DetailCard({
  title,
  success,
  reason,
}: {
  title: string;
  success: boolean;
  reason?: string;
}) {
  return (
    <div
      className={`rounded-md border p-3 ${
        success
          ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
          : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-medium">{title}</span>
        <Badge
          className={
            success
              ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
              : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
          }
        >
          {success ? 'Pass' : 'Fail'}
        </Badge>
      </div>
      {reason && <div className="text-xs text-muted-foreground">{reason}</div>}
    </div>
  );
}

function OutcomeBadge({ outcome }: { outcome: string | null }) {
  if (!outcome) return <span className="text-muted-foreground text-sm">-</span>;

  const styles: Record<string, string> = {
    queued: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    success: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    filtered: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
    validation_failed: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
    not_found: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
    error: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  };

  const labels: Record<string, string> = {
    queued: 'Queued',
    success: 'Success',
    filtered: 'Filtered',
    validation_failed: 'Auth Failed',
    not_found: 'Not Found',
    error: 'Error',
  };

  return (
    <Badge className={styles[outcome] || ''}>
      {labels[outcome] || outcome}
    </Badge>
  );
}

function StatusCodeBadge({ statusCode }: { statusCode: number }) {
  if (statusCode >= 200 && statusCode < 300) {
    return (
      <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
        {statusCode}
      </Badge>
    );
  }
  if (statusCode >= 400 && statusCode < 500) {
    return (
      <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
        {statusCode}
      </Badge>
    );
  }
  if (statusCode >= 500) {
    return (
      <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
        {statusCode}
      </Badge>
    );
  }
  return <Badge variant="outline">{statusCode}</Badge>;
}
