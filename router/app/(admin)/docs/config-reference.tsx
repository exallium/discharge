'use client';

import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, FileJson, GitBranch, Settings, Bot, Sparkles, ArrowUpCircle } from 'lucide-react';

export function ConfigReference() {
  return (
    <div className="space-y-6">
      {/* Overview */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileJson className="h-5 w-5" />
            .ai-bugs.json Configuration
          </CardTitle>
          <CardDescription>
            Configure how AI Bug Fixer investigates and fixes bugs in your repository
          </CardDescription>
        </CardHeader>
        <CardContent className="prose prose-sm dark:prose-invert max-w-none">
          <p>
            The <code>.ai-bugs.json</code> file lives in your repository root and customizes
            how the AI agent investigates and fixes different types of bugs. This file is
            optional - default settings will be used if not present.
          </p>

          <h4>Location</h4>
          <pre className="bg-muted p-3 rounded-md overflow-x-auto">
            <code>your-repo/.ai-bugs.json</code>
          </pre>
        </CardContent>
      </Card>

      {/* Schema Reference */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            Schema Reference
          </CardTitle>
          <CardDescription>
            Flexible configuration with global rules, named agents, and AI-driven triage
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* version */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <code className="font-mono text-sm bg-muted px-2 py-0.5 rounded">version</code>
              <Badge variant="destructive">required</Badge>
              <Badge variant="outline">string</Badge>
            </div>
            <p className="text-sm text-muted-foreground">Schema version. Use &quot;2&quot;.</p>
          </div>

          {/* rules */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <code className="font-mono text-sm bg-muted px-2 py-0.5 rounded">rules</code>
              <Badge variant="secondary">optional</Badge>
              <Badge variant="outline">array</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Global rules applied to all agents. Can be inline strings or file path references.
            </p>
            <pre className="bg-muted p-3 rounded-md overflow-x-auto text-xs">
{`"rules": [
  { "rulePath": "CLAUDE.md" },
  "Always include updates to relevant tests."
]`}
            </pre>
          </div>

          {/* agents */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <code className="font-mono text-sm bg-muted px-2 py-0.5 rounded">agents</code>
              <Badge variant="secondary">optional</Badge>
              <Badge variant="outline">object</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Named agents with their configuration. Can extend or override system agents.
            </p>
          </div>

          {/* config */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <code className="font-mono text-sm bg-muted px-2 py-0.5 rounded">config.secondaryRepos</code>
              <Badge variant="secondary">optional</Badge>
              <Badge variant="outline">string[]</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Array of &quot;owner/repo&quot; strings for secondary repositories.
            </p>
          </div>

          {/* config.sentry */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <code className="font-mono text-sm bg-muted px-2 py-0.5 rounded">config.sentry</code>
              <Badge variant="secondary">optional</Badge>
              <Badge variant="outline">object</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Sentry integration configuration. Auth tokens are configured separately in secrets.
            </p>
            <div className="ml-4 space-y-2 border-l-2 border-muted pl-4">
              <div>
                <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">organization</code>
                <Badge variant="destructive" className="ml-2 text-xs">required</Badge>
                <p className="text-xs text-muted-foreground mt-1">Sentry organization slug (visible in URLs)</p>
              </div>
              <div>
                <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">project</code>
                <Badge variant="destructive" className="ml-2 text-xs">required</Badge>
                <p className="text-xs text-muted-foreground mt-1">Sentry project slug (visible in URLs)</p>
              </div>
              <div>
                <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">instanceUrl</code>
                <Badge variant="secondary" className="ml-2 text-xs">optional</Badge>
                <p className="text-xs text-muted-foreground mt-1">Custom Sentry instance URL for self-hosted (defaults to https://sentry.io)</p>
              </div>
            </div>
          </div>

          {/* config.circleci */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <code className="font-mono text-sm bg-muted px-2 py-0.5 rounded">config.circleci</code>
              <Badge variant="secondary">optional</Badge>
              <Badge variant="outline">object</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              CircleCI integration configuration. Auth tokens are configured separately in secrets.
            </p>
            <div className="ml-4 space-y-2 border-l-2 border-muted pl-4">
              <div>
                <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">project</code>
                <Badge variant="destructive" className="ml-2 text-xs">required</Badge>
                <p className="text-xs text-muted-foreground mt-1">CircleCI project slug (e.g., &quot;gh/my-org/my-repo&quot;)</p>
              </div>
              <div>
                <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">configPath</code>
                <Badge variant="secondary" className="ml-2 text-xs">optional</Badge>
                <p className="text-xs text-muted-foreground mt-1">Path to CircleCI config file (defaults to .circleci/config.yml)</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* System Agents */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5" />
            System Agents
          </CardTitle>
          <CardDescription>
            Four-tier agent system with intelligent routing
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4">
            <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
              <Badge variant="secondary" className="mt-0.5">small</Badge>
              <div>
                <p className="font-medium">triage</p>
                <p className="text-sm text-muted-foreground">
                  Quick categorization - determines complexity and routes to appropriate agent
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
              <Badge variant="secondary" className="mt-0.5">medium</Badge>
              <div>
                <p className="font-medium">investigate</p>
                <p className="text-sm text-muted-foreground">
                  Deep analysis - reads code, identifies root cause, but doesn&apos;t implement fixes
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
              <Badge variant="secondary" className="mt-0.5">medium</Badge>
              <div>
                <p className="font-medium">simple</p>
                <p className="text-sm text-muted-foreground">
                  Simple fixes - straightforward bugs, typos, small features
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
              <Badge variant="secondary" className="mt-0.5">large</Badge>
              <div>
                <p className="font-medium">complex</p>
                <p className="text-sm text-muted-foreground">
                  Complex fixes - architectural changes, multi-file refactors, subtle bugs
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Agent Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Agent Configuration
          </CardTitle>
          <CardDescription>
            Configure custom agents or extend system agents
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <code className="font-mono text-sm bg-muted px-2 py-0.5 rounded">agentPath</code>
              <Badge variant="outline">string</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Path to agent-specific markdown file (relative to repo root).
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <code className="font-mono text-sm bg-muted px-2 py-0.5 rounded">model</code>
              <Badge variant="outline">&quot;small&quot; | &quot;medium&quot; | &quot;large&quot;</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Model tier for this agent. Defaults to the system default for that agent.
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <code className="font-mono text-sm bg-muted px-2 py-0.5 rounded">rules</code>
              <Badge variant="outline">array</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Agent-specific rules (appended to global rules).
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <code className="font-mono text-sm bg-muted px-2 py-0.5 rounded">description</code>
              <Badge variant="outline">string</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Human-readable description (shown in admin UI and used by triage).
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Escalation Labels */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ArrowUpCircle className="h-5 w-5" />
            Escalation Labels
          </CardTitle>
          <CardDescription>
            Labels to manually trigger agent re-runs
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3">
            <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
              <code className="font-mono text-sm bg-background px-2 py-1 rounded">escalate-complex</code>
              <span className="text-sm text-muted-foreground">Force re-run with complex agent (opus)</span>
            </div>
            <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
              <code className="font-mono text-sm bg-background px-2 py-1 rounded">escalate-investigate</code>
              <span className="text-sm text-muted-foreground">Re-run with investigate agent (analysis only)</span>
            </div>
            <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
              <code className="font-mono text-sm bg-background px-2 py-1 rounded">rerun-triage</code>
              <span className="text-sm text-muted-foreground">Re-trigger triage to re-evaluate complexity</span>
            </div>
            <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
              <code className="font-mono text-sm bg-background px-2 py-1 rounded">plan-approved</code>
              <span className="text-sm text-muted-foreground">Approve plan and start implementation</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Example */}
      <Card>
        <CardHeader>
          <CardTitle>Complete Example</CardTitle>
          <CardDescription>
            A full configuration with rules, custom agents, and service integrations
          </CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="bg-muted p-4 rounded-md overflow-x-auto text-xs">
{`{
  "version": "2",
  "rules": [
    { "rulePath": "CLAUDE.md" },
    "Always include updates to relevant tests."
  ],
  "agents": {
    "ui": {
      "agentPath": ".claude/agents/UI.md",
      "model": "medium",
      "description": "Handles UI/frontend issues"
    },
    "database": {
      "agentPath": ".claude/agents/DATABASE.md",
      "model": "large",
      "rules": ["Always create migrations for schema changes."],
      "description": "Database and migration work"
    }
  },
  "config": {
    "secondaryRepos": ["myorg/shared-types"],
    "sentry": {
      "organization": "my-org",
      "project": "my-project"
    },
    "circleci": {
      "project": "gh/my-org/my-repo"
    }
  }
}`}
          </pre>
        </CardContent>
      </Card>

      {/* Secondary Repos Warning */}
      <Card className="border-yellow-500/50 bg-yellow-500/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-yellow-600 dark:text-yellow-500">
            <GitBranch className="h-5 w-5" />
            Secondary Repositories
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-500 shrink-0 mt-0.5" />
            <div className="space-y-2">
              <p className="text-sm font-medium">
                GitHub App Access Required
              </p>
              <p className="text-sm text-muted-foreground">
                The GitHub App installation must have access to all secondary repositories.
                Ensure the app is installed on the same organization or add the repos to
                the app&apos;s repository access list.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <h4 className="text-sm font-medium">How It Works</h4>
            <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
              <li>Secondary repos are cloned read-only at <code>/workspace-secondary/repo-name</code></li>
              <li>The AI can read files from all secondary repos for context</li>
              <li>To submit a fix to a secondary repo, the AI sets <code>targetRepo</code> in analysis.json</li>
              <li>Comments always link back to the originating issue in the main repo</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* Service Integrations Info */}
      <Card className="border-blue-500/50 bg-blue-500/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-blue-600 dark:text-blue-500">
            <Settings className="h-5 w-5" />
            Service Integrations
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              The <code>config.sentry</code> and <code>config.circleci</code> blocks define public
              configuration (organization, project, URLs) that lives in your repository.
            </p>
          </div>

          <div className="space-y-2">
            <h4 className="text-sm font-medium">Secrets Configuration</h4>
            <p className="text-sm text-muted-foreground">
              Authentication tokens must be configured separately in the project settings:
            </p>
            <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
              <li><strong>Sentry:</strong> Auth token and webhook secret in Secrets page</li>
              <li><strong>CircleCI:</strong> API token in Secrets page</li>
            </ul>
          </div>

          <div className="space-y-2">
            <h4 className="text-sm font-medium">Self-Hosted Instances</h4>
            <p className="text-sm text-muted-foreground">
              For self-hosted Sentry, set <code>instanceUrl</code> to your instance URL.
              API calls will use this URL instead of sentry.io.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
