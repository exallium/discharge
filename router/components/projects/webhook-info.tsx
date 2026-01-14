'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Copy, Check, ExternalLink, Loader2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

interface WebhookInfoProps {
  enabledTriggers: string[];
}

interface TriggerInfo {
  id: string;
  type: string;
  webhookPath: string;
  webhookConfig: {
    events: string[];
    docsUrl: string;
  };
}

interface TriggersResponse {
  baseUrl: string | null;
  triggers: TriggerInfo[];
}

export function WebhookInfo({ enabledTriggers }: WebhookInfoProps) {
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [data, setData] = useState<TriggersResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchTriggers() {
      try {
        const response = await fetch('/api/triggers');
        if (response.ok) {
          setData(await response.json());
        }
      } catch (error) {
        console.error('Failed to fetch triggers:', error);
      } finally {
        setIsLoading(false);
      }
    }
    fetchTriggers();
  }, []);

  const handleCopy = async (value: string, field: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      toast.success('Copied to clipboard');
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      toast.error('Failed to copy');
    }
  };

  if (enabledTriggers.length === 0) {
    return null;
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Webhook Configuration</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const enabledTriggerInfo = data?.triggers.filter((t) =>
    enabledTriggers.includes(t.id)
  ) || [];

  if (enabledTriggerInfo.length === 0) {
    return null;
  }

  const baseUrl = data?.baseUrl;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Webhook Configuration</CardTitle>
        <CardDescription>
          Configure these webhooks in your external services
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {!baseUrl && (
          <div className="flex items-start gap-2 p-3 bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800 rounded-md">
            <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-400 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-yellow-800 dark:text-yellow-200">Base URL not configured</p>
              <p className="text-yellow-700 dark:text-yellow-300">
                Set the Base URL in Settings to see complete webhook URLs.
              </p>
            </div>
          </div>
        )}

        {enabledTriggerInfo.map((trigger) => {
          const webhookUrl = baseUrl
            ? `${baseUrl}${trigger.webhookPath}`
            : trigger.webhookPath;
          const urlFieldId = `webhook-url-${trigger.id}`;

          return (
            <div key={trigger.id} className="space-y-3">
              <h4 className="font-medium text-sm capitalize">{trigger.id.replace('-', ' ')}</h4>
              <div className="space-y-3 pl-4 border-l-2 border-muted">
                <div className="space-y-1.5">
                  <Label htmlFor={urlFieldId} className="text-xs text-muted-foreground">
                    Webhook URL
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id={urlFieldId}
                      value={webhookUrl}
                      readOnly
                      className="font-mono text-sm h-8"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={() => handleCopy(webhookUrl, urlFieldId)}
                    >
                      {copiedField === urlFieldId ? (
                        <Check className="h-4 w-4 text-green-500" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>

                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground">Events</span>
                  <p className="text-sm font-mono">
                    {trigger.webhookConfig.events.join(', ')}
                  </p>
                </div>

                <a
                  href={trigger.webhookConfig.docsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  Documentation
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
