'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { SecretField } from '@/components/ui/secret-field';
import { Badge } from '@/components/ui/badge';
import { Loader2, AlertCircle, CheckCircle2, Globe, Server } from 'lucide-react';
import type { SecretStatus } from '@/app/api/projects/[id]/secrets/route';

interface ProjectSecretsProps {
  projectId: string;
  enabledTriggers: string[];
}

const TRIGGER_LABELS: Record<string, string> = {
  'github-issues': 'GitHub Issues',
  sentry: 'Sentry',
  circleci: 'CircleCI',
};

const SOURCE_CONFIG = {
  project: { label: 'Project', variant: 'default' as const, icon: CheckCircle2 },
  global: { label: 'Global', variant: 'secondary' as const, icon: Globe },
  env: { label: 'Env', variant: 'outline' as const, icon: Server },
  none: { label: 'Missing', variant: 'destructive' as const, icon: AlertCircle },
};

export function ProjectSecrets({ projectId, enabledTriggers }: ProjectSecretsProps) {
  const [secrets, setSecrets] = useState<SecretStatus[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSecrets = useCallback(async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}/secrets`);
      if (!response.ok) {
        throw new Error('Failed to fetch secrets');
      }
      const data = await response.json();
      setSecrets(data.secrets);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load secrets');
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (enabledTriggers.length > 0) {
      fetchSecrets();
    } else {
      setIsLoading(false);
    }
  }, [enabledTriggers, fetchSecrets]);

  const handleSaveSecret = async (plugin: string, key: string, value: string) => {
    const response = await fetch(`/api/projects/${projectId}/secrets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plugin, key, value }),
    });
    if (!response.ok) {
      throw new Error('Failed to save secret');
    }
    await fetchSecrets();
  };

  const handleDeleteSecret = async (plugin: string, key: string) => {
    const response = await fetch(`/api/projects/${projectId}/secrets`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plugin, key }),
    });
    if (!response.ok) {
      throw new Error('Failed to delete secret');
    }
    await fetchSecrets();
  };

  // Group secrets by trigger
  const secretsByTrigger = secrets.reduce(
    (acc, secret) => {
      // Map plugin to trigger name
      const triggerName =
        secret.plugin === 'github' ? 'github-issues' : secret.plugin;
      if (!acc[triggerName]) {
        acc[triggerName] = [];
      }
      acc[triggerName].push(secret);
      return acc;
    },
    {} as Record<string, SecretStatus[]>
  );

  if (enabledTriggers.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Secrets</CardTitle>
          <CardDescription>Configure credentials for enabled integrations</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Enable at least one trigger above to configure secrets.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Secrets</CardTitle>
          <CardDescription>Configure credentials for enabled integrations</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Secrets</CardTitle>
          <CardDescription>Configure credentials for enabled integrations</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-destructive">
            <AlertCircle className="h-4 w-4" />
            <span className="text-sm">{error}</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Secrets</CardTitle>
        <CardDescription>
          Configure credentials for enabled integrations. Project secrets override global and
          environment variables.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {enabledTriggers.map((trigger) => {
          const triggerSecrets = secretsByTrigger[trigger] || [];
          if (triggerSecrets.length === 0) return null;

          return (
            <div key={trigger} className="space-y-3">
              <h4 className="font-medium text-sm">
                {TRIGGER_LABELS[trigger] || trigger}
              </h4>
              <div className="space-y-3 pl-4 border-l-2 border-muted">
                {triggerSecrets.map((secret) => {
                  const sourceConfig = SOURCE_CONFIG[secret.source];
                  const SourceIcon = sourceConfig.icon;

                  return (
                    <div key={secret.key} className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{secret.label}</span>
                        <Badge variant={sourceConfig.variant} className="text-xs gap-1">
                          <SourceIcon className="h-3 w-3" />
                          {sourceConfig.label}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{secret.description}</p>
                      <SecretField
                        value={secret.value}
                        masked={secret.masked}
                        source={secret.source}
                        onSave={(value) => handleSaveSecret(secret.plugin, secret.secretKey, value)}
                        onDelete={() => handleDeleteSecret(secret.plugin, secret.secretKey)}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
