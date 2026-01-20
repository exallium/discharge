'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Copy,
  Check,
  ExternalLink,
  Loader2,
  CheckCircle,
  AlertCircle,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { toast } from 'sonner';

interface SentrySetupGuideProps {
  projectId: string;
  sentryOrg?: string;
  sentryProject?: string;
  instanceUrl?: string;
}

interface ConnectionTestResult {
  success: boolean;
  message: string;
  details?: {
    organization?: string;
    tokenScopes?: string[];
  };
}

export function SentrySetupGuide({
  projectId,
  sentryOrg,
  sentryProject: _sentryProject,
  instanceUrl,
}: SentrySetupGuideProps) {
  const [webhookUrl, setWebhookUrl] = useState<string>('');
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(true);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);

  const sentryBaseUrl = instanceUrl || 'https://sentry.io';
  const settingsUrl = `${sentryBaseUrl}/settings/${sentryOrg || '{org-slug}'}/developer-settings/`;

  useEffect(() => {
    async function fetchBaseUrl() {
      try {
        const response = await fetch('/api/triggers');
        if (response.ok) {
          const data = await response.json();
          if (data.baseUrl) {
            setWebhookUrl(`${data.baseUrl}/webhooks/sentry`);
          } else {
            setWebhookUrl('/webhooks/sentry');
          }
        }
      } catch (error) {
        console.error('Failed to fetch base URL:', error);
        setWebhookUrl('/webhooks/sentry');
      }
    }
    fetchBaseUrl();
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

  const testConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/test-sentry`, {
        method: 'POST',
      });
      const result = await response.json();
      setTestResult(result);
      if (result.success) {
        toast.success('Sentry connection successful!');
      } else {
        toast.error(result.message || 'Connection test failed');
      }
    } catch {
      setTestResult({
        success: false,
        message: 'Failed to test connection',
      });
      toast.error('Failed to test connection');
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <Card className="border-purple-500/30 bg-purple-500/5">
      <CardHeader
        className="cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <svg
                className="h-5 w-5"
                viewBox="0 0 72 66"
                fill="currentColor"
              >
                <path d="M29,2.26a4.67,4.67,0,0,0-8,0L14.42,13.53A32.21,32.21,0,0,1,32.17,40.19H27.55A27.68,27.68,0,0,0,12.09,17.47L6,28a15.92,15.92,0,0,1,9.23,12.17H4.62A.76.76,0,0,1,4,39.06l2.94-5a10.74,10.74,0,0,0-3.36-1.9l-2.91,5a4.54,4.54,0,0,0,1.69,6.24A4.66,4.66,0,0,0,4.62,44H19.15a19.4,19.4,0,0,0-8-17.31l2.31-4A23.87,23.87,0,0,1,23.76,44H36.07a35.88,35.88,0,0,0-16.41-31.8l4.67-8a.77.77,0,0,1,1.05-.27c.53.29,20.29,34.77,20.66,35.17a.76.76,0,0,1-.68,1.13H40.6q.09,1.91,0,3.81h4.78A4.59,4.59,0,0,0,50,39.43a4.49,4.49,0,0,0-.62-2.28Z" />
              </svg>
              Sentry Internal Integration Setup
            </CardTitle>
            <CardDescription>
              Create an Internal Integration in Sentry for secure webhook delivery
            </CardDescription>
          </div>
          <Button type="button" variant="ghost" size="icon">
            {isExpanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
        </div>
      </CardHeader>

      {isExpanded && (
        <CardContent className="space-y-6">
          {/* Step 1: Create Integration */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="rounded-full h-6 w-6 p-0 flex items-center justify-center">
                1
              </Badge>
              <span className="font-medium">Create Internal Integration</span>
            </div>
            <div className="ml-8 space-y-2">
              <p className="text-sm text-muted-foreground">
                Go to Sentry → Settings → Developer Settings → Create New Internal Integration
              </p>
              <Button variant="outline" size="sm" asChild>
                <a
                  href={settingsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="gap-2"
                >
                  Open Sentry Developer Settings
                  <ExternalLink className="h-3 w-3" />
                </a>
              </Button>
            </div>
          </div>

          {/* Step 2: Configure Integration */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="rounded-full h-6 w-6 p-0 flex items-center justify-center">
                2
              </Badge>
              <span className="font-medium">Configure the Integration</span>
            </div>
            <div className="ml-8 space-y-4">
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground font-medium">Name</label>
                <div className="flex gap-2">
                  <Input
                    value="AI Bug Fixer"
                    readOnly
                    className="font-mono text-sm h-8 max-w-xs"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={() => handleCopy('AI Bug Fixer', 'name')}
                  >
                    {copiedField === 'name' ? (
                      <Check className="h-4 w-4 text-green-500" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs text-muted-foreground font-medium">Webhook URL</label>
                <div className="flex gap-2">
                  <Input
                    value={webhookUrl || 'Loading...'}
                    readOnly
                    className="font-mono text-sm h-8"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={() => handleCopy(webhookUrl, 'webhook')}
                    disabled={!webhookUrl}
                  >
                    {copiedField === 'webhook' ? (
                      <Check className="h-4 w-4 text-green-500" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs text-muted-foreground font-medium">Permissions</label>
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div className="flex items-center gap-2 p-2 bg-muted/50 rounded">
                    <code className="text-xs">project:read</code>
                  </div>
                  <div className="flex items-center gap-2 p-2 bg-muted/50 rounded">
                    <code className="text-xs">event:read</code>
                  </div>
                  <div className="flex items-center gap-2 p-2 bg-muted/50 rounded">
                    <code className="text-xs">event:write</code>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs text-muted-foreground font-medium">Webhooks</label>
                <div className="flex items-center gap-2 p-2 bg-muted/50 rounded text-sm">
                  <input type="checkbox" checked readOnly className="h-4 w-4" />
                  <span>issue</span>
                  <span className="text-muted-foreground">(created, resolved, assigned, etc.)</span>
                </div>
              </div>
            </div>
          </div>

          {/* Step 3: Copy Credentials */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="rounded-full h-6 w-6 p-0 flex items-center justify-center">
                3
              </Badge>
              <span className="font-medium">Save & Copy Credentials</span>
            </div>
            <div className="ml-8 space-y-2">
              <p className="text-sm text-muted-foreground">
                After saving the integration, copy these values from the bottom of the page:
              </p>
              <ul className="text-sm space-y-1 list-disc list-inside text-muted-foreground">
                <li><strong>Token</strong> → paste as &quot;Sentry Auth Token&quot; below</li>
                <li><strong>Client Secret</strong> → paste as &quot;Sentry Client Secret&quot; below</li>
              </ul>
            </div>
          </div>

          {/* Step 4: UI Component (Optional) */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="rounded-full h-6 w-6 p-0 flex items-center justify-center">
                4
              </Badge>
              <span className="font-medium">Add UI Component <span className="text-muted-foreground font-normal">(Optional)</span></span>
            </div>
            <div className="ml-8 space-y-3">
              <p className="text-sm text-muted-foreground">
                Add an Issue Link component to trigger triage/investigation directly from Sentry issues.
                In the Integration settings, scroll to &quot;Issue Link&quot; and add this JSON schema:
              </p>
              <pre className="text-xs bg-muted p-3 rounded overflow-x-auto">
{`{
  "elements": [
    {
      "type": "issue-link",
      "link": {
        "uri": "/api/webhooks/sentry-ui",
        "required_fields": [
          {
            "type": "select",
            "name": "mode",
            "label": "Action",
            "options": [
              ["triage", "Full Triage"],
              ["investigate", "Investigate Only"]
            ]
          }
        ]
      },
      "create": {
        "uri": "/api/webhooks/sentry-ui",
        "required_fields": [
          {
            "type": "select",
            "name": "mode",
            "label": "Action",
            "options": [
              ["triage", "Full Triage"],
              ["investigate", "Investigate Only"]
            ]
          }
        ]
      }
    }
  ]
}`}
              </pre>
              <p className="text-xs text-muted-foreground">
                This adds a &quot;Link AI Bug Fixer&quot; option to issue sidebars, letting you manually trigger analysis.
              </p>
            </div>
          </div>

          {/* Test Connection */}
          <div className="pt-4 border-t space-y-3">
            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={testConnection}
                disabled={isTesting}
              >
                {isTesting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Testing...
                  </>
                ) : (
                  'Test Connection'
                )}
              </Button>
              {testResult && (
                <div className="flex items-center gap-2 text-sm">
                  {testResult.success ? (
                    <>
                      <CheckCircle className="h-4 w-4 text-green-500" />
                      <span className="text-green-600">{testResult.message}</span>
                    </>
                  ) : (
                    <>
                      <AlertCircle className="h-4 w-4 text-red-500" />
                      <span className="text-red-600">{testResult.message}</span>
                    </>
                  )}
                </div>
              )}
            </div>
            {testResult?.details?.organization && (
              <p className="text-xs text-muted-foreground ml-1">
                Connected to organization: <strong>{testResult.details.organization}</strong>
              </p>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}
