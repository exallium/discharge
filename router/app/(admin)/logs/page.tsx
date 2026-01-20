// Force dynamic rendering - page fetches data from database
export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { FileText, CheckCircle2, AlertTriangle, Clock, Filter } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { apiLogsRepo } from '@/src/db/repositories';
import { LogsTable } from './logs-table';

interface LogsPageProps {
  searchParams: Promise<{
    page?: string;
    search?: string;
    status?: string;
    outcome?: string;
  }>;
}

export default async function LogsPage({ searchParams }: LogsPageProps) {
  const {
    page: pageParam,
    search,
    status: statusFilter,
    outcome: outcomeFilter,
  } = await searchParams;

  const page = parseInt(pageParam || '1', 10);
  const limit = 50;
  const offset = (page - 1) * limit;

  // Build filters based on query params
  const filters: {
    search?: string;
    statusCodeMin?: number;
    statusCodeMax?: number;
  } = {};

  if (search) {
    filters.search = search;
  }

  if (statusFilter === 'success') {
    filters.statusCodeMin = 200;
    filters.statusCodeMax = 299;
  } else if (statusFilter === 'error') {
    filters.statusCodeMin = 400;
  }

  const [logs, stats, totalCount] = await Promise.all([
    apiLogsRepo.find(filters, { limit, offset }),
    apiLogsRepo.getStats(),
    apiLogsRepo.count(filters),
  ]);

  // Filter by outcome client-side for now (could be added to DB query later)
  const filteredLogs = outcomeFilter
    ? logs.filter((log) => log.outcome === outcomeFilter)
    : logs;

  const totalPages = Math.ceil(totalCount / limit);

  return (
    <div className="space-y-6">
      <PageHeader
        title="API Logs"
        description="View webhook and API request history with detailed pipeline tracing"
      />

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <StatCard
          title="Total Requests"
          value={stats.total}
          icon={FileText}
        />
        <StatCard
          title="Success (2xx)"
          value={stats.success}
          icon={CheckCircle2}
        />
        <StatCard
          title="Errors (4xx/5xx)"
          value={stats.clientErrors + stats.serverErrors}
          icon={AlertTriangle}
        />
        <StatCard
          title="Avg Response"
          value={stats.avgResponseTimeMs ? `${stats.avgResponseTimeMs}ms` : '-'}
          icon={Clock}
        />
      </div>

      <Card>
        <CardContent className="pt-6">
          {/* Filters */}
          <form className="mb-4 flex flex-wrap items-center gap-4">
            <input
              type="text"
              name="search"
              placeholder="Search path, trigger, event, requestId..."
              defaultValue={search || ''}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm max-w-sm flex-1"
            />
            <select
              name="status"
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              defaultValue={statusFilter || ''}
            >
              <option value="">All status codes</option>
              <option value="success">Success (2xx)</option>
              <option value="error">Errors (4xx/5xx)</option>
            </select>
            <select
              name="outcome"
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              defaultValue={outcomeFilter || ''}
            >
              <option value="">All outcomes</option>
              <option value="queued">Queued</option>
              <option value="filtered">Filtered</option>
              <option value="validation_failed">Validation Failed</option>
              <option value="error">Error</option>
              <option value="success">Success</option>
            </select>
            <Button type="submit" variant="secondary" size="sm">
              <Filter className="h-4 w-4 mr-1" />
              Filter
            </Button>
            {(search || statusFilter || outcomeFilter) && (
              <Button variant="ghost" size="sm" asChild>
                <Link href="/logs">Clear</Link>
              </Button>
            )}
          </form>

          {filteredLogs.length === 0 ? (
            <EmptyState
              title="No logs yet"
              description="API request logs will appear here when webhooks and API requests are received."
            />
          ) : (
            <>
              <LogsTable logs={filteredLogs} />

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="mt-4 flex items-center justify-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    asChild
                  >
                    <Link
                      href={buildPageUrl(page - 1, search, statusFilter, outcomeFilter)}
                    >
                      Previous
                    </Link>
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    Page {page} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages}
                    asChild
                  >
                    <Link
                      href={buildPageUrl(page + 1, search, statusFilter, outcomeFilter)}
                    >
                      Next
                    </Link>
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function buildPageUrl(
  page: number,
  search?: string,
  status?: string,
  outcome?: string
): string {
  const params = new URLSearchParams();
  params.set('page', String(page));
  if (search) params.set('search', search);
  if (status) params.set('status', status);
  if (outcome) params.set('outcome', outcome);
  return `/logs?${params.toString()}`;
}
