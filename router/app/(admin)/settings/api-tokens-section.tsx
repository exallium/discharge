'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Key, Trash2, Copy, Check, Terminal } from 'lucide-react';

interface ApiToken {
  key: string;
  label: string;
  createdAt: string;
}

interface NewToken {
  key: string;
  token: string;
  label: string;
  prefix: string;
}

export function ApiTokensSection() {
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [newToken, setNewToken] = useState<NewToken | null>(null);
  const [label, setLabel] = useState('CLI Token');
  const [isGenerating, setIsGenerating] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const serverUrl = typeof window !== 'undefined'
    ? window.location.origin
    : '';

  useEffect(() => {
    fetchTokens();
  }, []);

  async function fetchTokens() {
    try {
      const response = await fetch('/api/settings/api-tokens');
      if (response.ok) {
        const data = await response.json();
        setTokens(data.tokens);
      }
    } catch (err) {
      console.error('Failed to fetch tokens:', err);
    } finally {
      setIsLoading(false);
    }
  }

  async function generateToken() {
    setIsGenerating(true);
    setError(null);
    try {
      const response = await fetch('/api/settings/api-tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to generate token');
      }
      const data = await response.json();
      setNewToken(data);
      setLabel('CLI Token');
      await fetchTokens();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate token');
    } finally {
      setIsGenerating(false);
    }
  }

  async function revokeToken(key: string) {
    try {
      const response = await fetch('/api/settings/api-tokens', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      });
      if (response.ok) {
        setTokens(tokens.filter((t) => t.key !== key));
      }
    } catch (err) {
      console.error('Failed to revoke token:', err);
    }
  }

  function copyToClipboard(text: string, field: string) {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Key className="h-5 w-5" />
          API Tokens
        </CardTitle>
        <CardDescription>
          Generate tokens for the Discharge CLI to submit and monitor AI tasks.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* New token display - shown immediately after generation */}
        {newToken && (
          <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-4 space-y-4">
            <div className="flex items-start gap-2">
              <Check className="h-5 w-5 text-green-600 mt-0.5 shrink-0" />
              <div className="space-y-1 min-w-0">
                <p className="font-medium text-sm">Token generated</p>
                <p className="text-xs text-muted-foreground">
                  Copy it now — it won&apos;t be shown again.
                </p>
              </div>
            </div>

            {/* Token value */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Token</Label>
              <div className="flex gap-2">
                <code className="flex-1 rounded bg-muted px-3 py-2 text-xs font-mono break-all">
                  {newToken.token}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => copyToClipboard(newToken.token, 'token')}
                >
                  {copiedField === 'token' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            {/* Quick setup command */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground flex items-center gap-1">
                <Terminal className="h-3 w-3" />
                Quick setup — paste this in your terminal
              </Label>
              <div className="flex gap-2">
                <code className="flex-1 rounded bg-muted px-3 py-2 text-xs font-mono break-all">
                  {`echo 'export DISCHARGE_TOKEN=${newToken.token}' >> ~/.zshrc && source ~/.zshrc`}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => copyToClipboard(
                    `echo 'export DISCHARGE_TOKEN=${newToken.token}' >> ~/.zshrc && source ~/.zshrc`,
                    'env'
                  )}
                >
                  {copiedField === 'env' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            {/* Link command */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground flex items-center gap-1">
                <Terminal className="h-3 w-3" />
                Then link a project (run from your repo directory)
              </Label>
              <div className="flex gap-2">
                <code className="flex-1 rounded bg-muted px-3 py-2 text-xs font-mono break-all">
                  {`discharge link ${serverUrl} <project-id>`}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => copyToClipboard(
                    `discharge link ${serverUrl} <project-id>`,
                    'link'
                  )}
                >
                  {copiedField === 'link' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => setNewToken(null)}
              className="text-xs"
            >
              Dismiss
            </Button>
          </div>
        )}

        {/* Generate new token */}
        {!newToken && (
          <div className="flex gap-2 items-end">
            <div className="flex-1 space-y-2">
              <Label htmlFor="token-label" className="text-sm">Label</Label>
              <Input
                id="token-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. My Laptop"
                className="h-9"
              />
            </div>
            <Button
              onClick={generateToken}
              disabled={isGenerating || !label}
              size="sm"
              className="h-9"
            >
              {isGenerating ? 'Generating...' : 'Generate Token'}
            </Button>
          </div>
        )}

        {error && (
          <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Existing tokens list */}
        {!isLoading && tokens.length > 0 && (
          <div className="space-y-2">
            <Label className="text-sm text-muted-foreground">Active tokens</Label>
            <div className="rounded-lg border divide-y">
              {tokens.map((token) => (
                <div key={token.key} className="flex items-center justify-between px-3 py-2">
                  <div className="space-y-0.5">
                    <span className="text-sm font-medium">{token.label}</span>
                    <p className="text-xs text-muted-foreground">
                      Created {new Date(token.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => revokeToken(token.key)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {!isLoading && tokens.length === 0 && !newToken && (
          <p className="text-sm text-muted-foreground">
            No API tokens yet. Generate one to use the Discharge CLI.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
