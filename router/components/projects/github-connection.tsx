'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Github, CheckCircle2, ExternalLink, Unlink, AlertCircle } from 'lucide-react';

interface GitHubAppStatus {
  configured: boolean;
  appName?: string;
}

interface GitHubInstallationStatus {
  installed: boolean;
  accountLogin?: string;
  accountType?: string;
  installedAt?: string;
}

interface GitHubConnectionProps {
  projectId: string;
  isNewProject?: boolean;
  canConnect?: boolean;
  onSaveProject?: () => Promise<boolean>;
}

export function GitHubConnection({ projectId, isNewProject = false, canConnect = true, onSaveProject }: GitHubConnectionProps) {
  const [appStatus, setAppStatus] = useState<GitHubAppStatus | null>(null);
  const [installStatus, setInstallStatus] = useState<GitHubInstallationStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchStatus();
  }, [projectId, isNewProject]);

  async function fetchStatus() {
    setIsLoading(true);
    try {
      // For new projects, only fetch app status (no installation yet)
      if (isNewProject) {
        const appRes = await fetch('/api/github/app');
        if (appRes.ok) {
          setAppStatus(await appRes.json());
        }
        setInstallStatus({ installed: false });
      } else {
        // Fetch both app status and installation status in parallel
        const [appRes, installRes] = await Promise.all([
          fetch('/api/github/app'),
          fetch(`/api/github/install?projectId=${projectId}`),
        ]);

        if (appRes.ok) {
          setAppStatus(await appRes.json());
        }
        if (installRes.ok) {
          setInstallStatus(await installRes.json());
        }
      }
    } catch (err) {
      console.error('Failed to fetch GitHub status:', err);
      setError('Failed to load GitHub connection status');
    } finally {
      setIsLoading(false);
    }
  }

  async function handleConnect() {
    setIsConnecting(true);
    setError(null);

    try {
      // For new projects, save the project first
      if (isNewProject && onSaveProject) {
        const saved = await onSaveProject();
        if (!saved) {
          throw new Error('Failed to save project');
        }
      }

      // Get the install URL and redirect
      const response = await fetch(`/api/github/install?projectId=${projectId}`);
      const data = await response.json();

      if (data.installUrl) {
        window.location.href = data.installUrl;
      } else if (data.installed) {
        // Already installed, just refresh
        await fetchStatus();
      } else {
        throw new Error('Failed to get installation URL');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect to GitHub');
      setIsConnecting(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm('Are you sure you want to disconnect this project from GitHub?')) {
      return;
    }

    setIsDisconnecting(true);
    setError(null);

    try {
      const response = await fetch(`/api/github/install?projectId=${projectId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to disconnect from GitHub');
      }

      setInstallStatus({ installed: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect');
    } finally {
      setIsDisconnecting(false);
    }
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Github className="h-5 w-5" />
            GitHub Connection
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

  // App not configured at system level
  if (!appStatus?.configured) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Github className="h-5 w-5" />
            GitHub Connection
          </CardTitle>
          <CardDescription>
            Connect this project to GitHub for automatic PR creation
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950 p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                  GitHub App not configured
                </p>
                <p className="text-sm text-amber-700 dark:text-amber-300">
                  A GitHub App must be created in Settings before you can connect projects.
                </p>
                <a
                  href="/settings"
                  className="text-sm text-amber-800 dark:text-amber-200 underline hover:no-underline inline-flex items-center gap-1 mt-2"
                >
                  Go to Settings
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Github className="h-5 w-5" />
          GitHub Connection
        </CardTitle>
        <CardDescription>
          {installStatus?.installed
            ? 'This project is connected to GitHub'
            : 'Connect this project to GitHub for automatic PR creation'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {installStatus?.installed ? (
          // Connected - show status
          <div className="rounded-lg border p-4 space-y-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <span className="font-medium">Connected to {installStatus.accountLogin}</span>
              <span className="text-xs text-muted-foreground">
                ({installStatus.accountType})
              </span>
            </div>
            {installStatus.installedAt && (
              <p className="text-sm text-muted-foreground">
                Connected {new Date(installStatus.installedAt).toLocaleDateString()}
              </p>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={handleDisconnect}
              disabled={isDisconnecting}
            >
              {isDisconnecting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Disconnecting...
                </>
              ) : (
                <>
                  <Unlink className="h-4 w-4 mr-1" />
                  Disconnect
                </>
              )}
            </Button>
          </div>
        ) : (
          // Not connected - show connect button
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Connect to GitHub to allow automatic pull request creation for this project&apos;s repository.
            </p>
            {isNewProject && !canConnect ? (
              <p className="text-sm text-amber-600 dark:text-amber-400">
                Fill in the Project ID, Repository, and Clone URL above to enable GitHub connection.
              </p>
            ) : isNewProject ? (
              <p className="text-sm text-muted-foreground">
                The project will be saved automatically when you connect to GitHub.
              </p>
            ) : null}
            <Button type="button" onClick={handleConnect} disabled={isConnecting || !canConnect}>
              {isConnecting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {isNewProject ? 'Saving & redirecting...' : 'Redirecting to GitHub...'}
                </>
              ) : (
                <>
                  <Github className="mr-2 h-4 w-4" />
                  Connect to GitHub
                </>
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
