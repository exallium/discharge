'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, Github, AlertCircle, ExternalLink, Search, Lock, Globe } from 'lucide-react';

interface Repository {
  id: number;
  name: string;
  fullName: string;
  private: boolean;
  defaultBranch: string;
  description: string | null;
  htmlUrl: string;
  cloneUrl: string;
  owner: {
    login: string;
    type: string;
  };
}

interface RepositoryPickerProps {
  onSelect: (repo: Repository) => void;
  selectedRepo?: string;
}

export function RepositoryPicker({ onSelect, selectedRepo }: RepositoryPickerProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [appConfigured, setAppConfigured] = useState(false);
  const [hasInstallations, setHasInstallations] = useState(false);
  const [installUrl, setInstallUrl] = useState<string | null>(null);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);

  useEffect(() => {
    fetchRepositories();
  }, []);

  async function fetchRepositories() {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/github/repositories');
      const data = await response.json();

      if (!response.ok) {
        // API returned an error status
        setError(data.error || 'Failed to load repositories');
        // Don't change appConfigured on error - we don't know the state
        return;
      }

      setAppConfigured(data.appConfigured ?? false);
      setHasInstallations(data.hasInstallations ?? false);
      setInstallUrl(data.installUrl ?? null);
      setRepositories(data.repositories ?? []);

      if (data.message && !data.appConfigured) {
        // Only show message if it's explaining why app isn't configured
        setError(data.message);
      }
    } catch (err) {
      setError('Failed to load repositories');
      console.error('Failed to fetch repositories:', err);
    } finally {
      setIsLoading(false);
    }
  }

  function handleConnect() {
    if (installUrl) {
      setIsConnecting(true);
      window.location.href = installUrl;
    }
  }

  function handleRepoSelect(fullName: string) {
    const repo = repositories.find(r => r.fullName === fullName);
    if (repo) {
      onSelect(repo);
    }
  }

  // Filter repositories based on search query
  const filteredRepos = searchQuery
    ? repositories.filter(repo =>
        repo.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (repo.description?.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    : repositories;

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Github className="h-5 w-5" />
            Select Repository
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading repositories...
          </div>
        </CardContent>
      </Card>
    );
  }

  // GitHub App not configured
  if (!appConfigured) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Github className="h-5 w-5" />
            Select Repository
          </CardTitle>
          <CardDescription>
            Connect to GitHub to select a repository
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
                  A GitHub App must be created in Settings before you can connect repositories.
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

  // No GitHub installations
  if (!hasInstallations) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Github className="h-5 w-5" />
            Select Repository
          </CardTitle>
          <CardDescription>
            Connect to GitHub to select a repository
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Install the GitHub App on your account or organization to grant access to repositories.
          </p>
          <Button onClick={handleConnect} disabled={isConnecting}>
            {isConnecting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Redirecting to GitHub...
              </>
            ) : (
              <>
                <Github className="mr-2 h-4 w-4" />
                Connect GitHub Account
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Has installations - show repo picker
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Github className="h-5 w-5" />
          Select Repository
        </CardTitle>
        <CardDescription>
          Choose a repository from your connected GitHub accounts
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {repositories.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground">
            <p>No repositories found.</p>
            <p className="text-sm mt-2">
              Make sure the GitHub App has access to at least one repository.
            </p>
            <Button variant="outline" size="sm" onClick={handleConnect} className="mt-4">
              <Github className="mr-2 h-4 w-4" />
              Manage GitHub Access
            </Button>
          </div>
        ) : (
          <>
            {/* Search input for large repo lists */}
            {repositories.length > 10 && (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search repositories..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
            )}

            <Select value={selectedRepo} onValueChange={handleRepoSelect}>
              <SelectTrigger>
                <SelectValue placeholder="Select a repository" />
              </SelectTrigger>
              <SelectContent>
                {filteredRepos.map((repo) => (
                  <SelectItem key={repo.id} value={repo.fullName}>
                    <div className="flex items-center gap-2">
                      {repo.private ? (
                        <Lock className="h-3 w-3 text-muted-foreground" />
                      ) : (
                        <Globe className="h-3 w-3 text-muted-foreground" />
                      )}
                      <span>{repo.fullName}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {filteredRepos.length === 0 && searchQuery && (
              <p className="text-sm text-muted-foreground text-center py-2">
                No repositories match &quot;{searchQuery}&quot;
              </p>
            )}

            <div className="flex justify-end">
              <Button variant="ghost" size="sm" onClick={handleConnect}>
                <Github className="mr-2 h-4 w-4" />
                Connect Another Account
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
