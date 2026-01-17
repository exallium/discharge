'use client';

import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Loader2, Github, CheckCircle2, ExternalLink, Trash2 } from 'lucide-react';

interface GitHubAppStatus {
  configured: boolean;
  appName?: string;
  appSlug?: string;
  htmlUrl?: string;
}

export function GitHubAppSection() {
  const [status, setStatus] = useState<GitHubAppStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // Fetch status on mount
  useEffect(() => {
    fetchStatus();
  }, []);

  async function fetchStatus() {
    try {
      const response = await fetch('/api/github/app');
      if (response.ok) {
        const data = await response.json();
        setStatus(data);
      }
    } catch (err) {
      console.error('Failed to fetch GitHub App status:', err);
      setError('Failed to load GitHub App status');
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCreateApp() {
    setIsCreating(true);
    setError(null);

    try {
      const response = await fetch('/api/github/app', { method: 'POST' });
      if (!response.ok) {
        throw new Error('Failed to generate app manifest');
      }

      const { url, manifest } = await response.json();

      // Create a hidden form and submit to GitHub
      // GitHub's manifest flow requires a POST with the manifest in a form field
      if (formRef.current) {
        const input = formRef.current.querySelector('input[name="manifest"]') as HTMLInputElement;
        input.value = manifest;
        formRef.current.action = url;
        formRef.current.submit();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create GitHub App');
      setIsCreating(false);
    }
  }

  async function handleDeleteApp() {
    setIsDeleting(true);
    setError(null);

    try {
      const response = await fetch('/api/github/app', { method: 'DELETE' });
      if (!response.ok) {
        throw new Error('Failed to delete GitHub App configuration');
      }

      setShowDeleteDialog(false);
      setStatus({ configured: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete GitHub App');
    } finally {
      setIsDeleting(false);
    }
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Github className="h-5 w-5" />
            GitHub App
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading...
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Github className="h-5 w-5" />
            GitHub App
          </CardTitle>
          <CardDescription>
            {status?.configured
              ? 'Your GitHub App is configured. Projects can connect to GitHub repositories.'
              : 'Create a GitHub App to enable automatic PR creation and repository access.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {status?.configured ? (
            // App is configured - show details
            <div className="rounded-lg border p-4 space-y-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <span className="font-medium">{status.appName}</span>
              </div>
              <div className="flex items-center gap-4">
                {status.htmlUrl && (
                  <a
                    href={status.htmlUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"
                  >
                    View on GitHub
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setShowDeleteDialog(true)}
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  Remove
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                To connect a project, go to the project settings and click &quot;Connect to GitHub&quot;.
              </p>
            </div>
          ) : (
            // App not configured - show create button
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Creating a GitHub App allows the system to create pull requests and interact with
                repositories as its own identity, separate from your personal account.
              </p>
              <Button onClick={handleCreateApp} disabled={isCreating}>
                {isCreating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Redirecting to GitHub...
                  </>
                ) : (
                  <>
                    <Github className="mr-2 h-4 w-4" />
                    Create GitHub App
                  </>
                )}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Hidden form for GitHub manifest submission */}
      <form ref={formRef} method="POST" style={{ display: 'none' }}>
        <input type="hidden" name="manifest" />
      </form>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove GitHub App</DialogTitle>
            <DialogDescription>
              This will remove the GitHub App configuration from this system.
              All project connections will stop working. The app will still exist on GitHub
              and must be deleted separately if desired.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDeleteDialog(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteApp}
              disabled={isDeleting}
            >
              {isDeleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Removing...
                </>
              ) : (
                'Remove App'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
