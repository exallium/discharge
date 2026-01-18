'use client';

import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Loader2,
  CheckCircle,
  AlertCircle,
  AlertTriangle,
  FileJson,
  GitBranch,
  Info,
} from 'lucide-react';

interface SecondaryRepoAccess {
  repo: string;
  hasAccess: boolean;
}

interface ValidationResult {
  exists: boolean;
  valid?: boolean;
  error?: string;
  message?: string;
  config?: {
    version: string;
    categoryCount: number;
    categoryNames: string[];
    hasConstraints: boolean;
  };
  secondaryRepos?: SecondaryRepoAccess[];
  warnings?: string[];
}

interface AiBugsValidatorProps {
  repoFullName: string | null;
}

export function AiBugsValidator({ repoFullName }: AiBugsValidatorProps) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [result, setResult] = useState<ValidationResult | null>(null);

  useEffect(() => {
    if (!repoFullName) {
      setStatus('idle');
      setResult(null);
      return;
    }

    const validateConfig = async () => {
      setStatus('loading');
      try {
        const response = await fetch('/api/projects/validate-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ repoFullName }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          setResult({ exists: false, error: errorData.error || 'Failed to validate' });
          setStatus('error');
          return;
        }

        const data = await response.json();
        setResult(data);
        setStatus(data.error ? 'error' : 'success');
      } catch {
        setResult({ exists: false, error: 'Failed to validate configuration' });
        setStatus('error');
      }
    };

    validateConfig();
  }, [repoFullName]);

  if (!repoFullName) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileJson className="h-5 w-5" />
          Repository Configuration
        </CardTitle>
        <CardDescription>
          Preview of .ai-bugs.json configuration from the repository
        </CardDescription>
      </CardHeader>
      <CardContent>
        {status === 'loading' && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Checking repository configuration...</span>
          </div>
        )}

        {status === 'success' && result && !result.exists && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Info className="h-4 w-4" />
            <span>{result.message || 'No .ai-bugs.json found - default settings will be used'}</span>
          </div>
        )}

        {status === 'error' && result?.error && (
          <div className="flex items-center gap-2 text-destructive">
            <AlertCircle className="h-4 w-4" />
            <span>{result.error}</span>
          </div>
        )}

        {status === 'success' && result?.exists && !result.valid && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-4 w-4" />
              <span>Invalid configuration</span>
            </div>
            <p className="text-sm text-muted-foreground">{result.error}</p>
          </div>
        )}

        {status === 'success' && result?.exists && result.valid && result.config && (
          <div className="space-y-4">
            {/* Config Summary */}
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <span>Valid configuration (v{result.config.version})</span>
            </div>

            {/* Categories */}
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Categories ({result.config.categoryCount})</h4>
              <div className="flex flex-wrap gap-1">
                {result.config.categoryNames.map((name) => (
                  <Badge key={name} variant="secondary">
                    {name}
                  </Badge>
                ))}
              </div>
            </div>

            {/* Constraints */}
            {result.config.hasConstraints && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Info className="h-4 w-4" />
                <span>Custom constraints configured</span>
              </div>
            )}

            {/* Secondary Repos */}
            {result.secondaryRepos && result.secondaryRepos.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium flex items-center gap-2">
                  <GitBranch className="h-4 w-4" />
                  Secondary Repositories ({result.secondaryRepos.length})
                </h4>
                <div className="space-y-1">
                  {result.secondaryRepos.map((repo) => (
                    <div key={repo.repo} className="flex items-center gap-2 text-sm">
                      {repo.hasAccess ? (
                        <CheckCircle className="h-3 w-3 text-green-500" />
                      ) : (
                        <AlertTriangle className="h-3 w-3 text-yellow-500" />
                      )}
                      <code className="text-xs bg-muted px-1 py-0.5 rounded">{repo.repo}</code>
                      {!repo.hasAccess && (
                        <span className="text-xs text-yellow-600">No access</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Warnings */}
            {result.warnings && result.warnings.length > 0 && (
              <div className="space-y-1 pt-2 border-t">
                {result.warnings.map((warning, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm text-yellow-600">
                    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                    <span>{warning}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
