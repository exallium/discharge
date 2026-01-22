/**
 * Resource Links - External link icons for issues/PRs
 */

import Link from 'next/link';
import { ExternalLink, GitPullRequest } from 'lucide-react';
import { Button } from './button';

export interface ResourceLinksProps {
  /** URL to the external issue/source (e.g., GitHub issue, Sentry issue) */
  issueUrl?: string | null;
  /** URL to the PR created for this conversation */
  prUrl?: string | null;
  /** PR number for display in tooltip */
  prNumber?: number | null;
  /** Size of the icon buttons */
  size?: 'sm' | 'default';
}

/**
 * Display external link icons for issues and PRs
 */
export function ResourceLinks({
  issueUrl,
  prUrl,
  prNumber,
  size = 'sm',
}: ResourceLinksProps) {
  const iconSize = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4';
  const buttonSize = size === 'sm' ? 'h-7 w-7' : 'h-8 w-8';

  // No links to show
  if (!issueUrl && !prUrl) {
    return null;
  }

  return (
    <div className="inline-flex items-center gap-1">
      {issueUrl && (
        <Button
          variant="ghost"
          size="icon"
          className={buttonSize}
          asChild
          title="View external issue"
        >
          <Link href={issueUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink className={iconSize} />
            <span className="sr-only">View external issue</span>
          </Link>
        </Button>
      )}
      {prUrl && (
        <Button
          variant="ghost"
          size="icon"
          className={buttonSize}
          asChild
          title={`View PR${prNumber ? ` #${prNumber}` : ''}`}
        >
          <Link href={prUrl} target="_blank" rel="noopener noreferrer">
            <GitPullRequest className={`${iconSize} text-green-600`} />
            <span className="sr-only">View pull request{prNumber ? ` #${prNumber}` : ''}</span>
          </Link>
        </Button>
      )}
    </div>
  );
}

/**
 * Extract issue URL from trigger event data
 */
export function extractIssueUrl(triggerEvent: Record<string, unknown> | null): string | null {
  if (!triggerEvent) return null;

  // Try common paths for issue URLs
  // GitHub/GitLab: triggerEvent.links.web
  // Sentry: triggerEvent.url or triggerEvent.links.web
  const links = triggerEvent.links as Record<string, unknown> | undefined;
  if (links?.web && typeof links.web === 'string') {
    return links.web;
  }

  // Direct url field (Sentry)
  if (triggerEvent.url && typeof triggerEvent.url === 'string') {
    return triggerEvent.url;
  }

  // HTML URL (GitHub API response)
  if (triggerEvent.html_url && typeof triggerEvent.html_url === 'string') {
    return triggerEvent.html_url;
  }

  return null;
}
