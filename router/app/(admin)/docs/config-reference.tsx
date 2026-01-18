'use client';

import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, FileJson, GitBranch, Settings, Shield, Tag, Bot, Sparkles, ArrowUpCircle } from 'lucide-react';

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

          <h4>Schema Versions</h4>
          <ul>
            <li><strong>Version 2 (Recommended)</strong>: Rules + Agents system with AI-driven triage</li>
            <li><strong>Version 1 (Legacy)</strong>: Category-based configuration</li>
          </ul>
        </CardContent>
      </Card>

      {/* Version 2 Schema */}
      <Card className="border-green-500/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-green-600" />
            Version 2: Rules + Agents
            <Badge className="ml-2">Recommended</Badge>
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
            <p className="text-sm text-muted-foreground">Schema version. Use &quot;2&quot; for the rules + agents system.</p>
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
              <Badge variant="secondary" className="mt-0.5">haiku</Badge>
              <div>
                <p className="font-medium">triage</p>
                <p className="text-sm text-muted-foreground">
                  Quick categorization - determines complexity and routes to appropriate agent
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
              <Badge variant="secondary" className="mt-0.5">sonnet</Badge>
              <div>
                <p className="font-medium">investigate</p>
                <p className="text-sm text-muted-foreground">
                  Deep analysis - reads code, identifies root cause, but doesn&apos;t implement fixes
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
              <Badge variant="secondary" className="mt-0.5">sonnet</Badge>
              <div>
                <p className="font-medium">simple</p>
                <p className="text-sm text-muted-foreground">
                  Simple fixes - straightforward bugs, typos, small features
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
              <Badge variant="secondary" className="mt-0.5">opus</Badge>
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
              <Badge variant="outline">&quot;haiku&quot; | &quot;sonnet&quot; | &quot;opus&quot;</Badge>
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

      {/* V2 Example */}
      <Card>
        <CardHeader>
          <CardTitle>Version 2 Example</CardTitle>
          <CardDescription>
            A full v2 configuration with rules and custom agents
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
      "model": "sonnet",
      "description": "Handles UI/frontend issues"
    },
    "database": {
      "agentPath": ".claude/agents/DATABASE.md",
      "model": "opus",
      "rules": ["Always create migrations for schema changes."],
      "description": "Database and migration work"
    }
  },
  "config": {
    "secondaryRepos": ["myorg/shared-types"]
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

      {/* Version 1 Legacy */}
      <Card className="border-muted">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Tag className="h-5 w-5 text-muted-foreground" />
            Version 1: Categories
            <Badge variant="outline" className="ml-2">Legacy</Badge>
          </CardTitle>
          <CardDescription>
            Category-based configuration (still supported for backwards compatibility)
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
            <p className="text-sm text-muted-foreground">Schema version &quot;1.0&quot;.</p>
          </div>

          {/* secondaryRepos */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <code className="font-mono text-sm bg-muted px-2 py-0.5 rounded">secondaryRepos</code>
              <Badge variant="secondary">optional</Badge>
              <Badge variant="outline">string[]</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Array of &quot;owner/repo&quot; strings for secondary repositories.
            </p>
          </div>

          {/* categories */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <code className="font-mono text-sm bg-muted px-2 py-0.5 rounded">categories</code>
              <Badge variant="destructive">required</Badge>
              <Badge variant="outline">object</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Map of category names to their configurations. Use &quot;default&quot; as a fallback.
            </p>
          </div>

          {/* constraints */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <code className="font-mono text-sm bg-muted px-2 py-0.5 rounded">constraints</code>
              <Badge variant="secondary">optional</Badge>
              <Badge variant="outline">object</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Global constraints: <code>excludePaths</code>, <code>requireTests</code>, <code>maxFilesChanged</code>.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* V1 Category Configuration */}
      <Card className="border-muted">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-muted-foreground">
            <Shield className="h-5 w-5" />
            Category Configuration (v1)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <code className="font-mono text-sm bg-muted px-2 py-0.5 rounded">match.labels</code>
            <span className="text-sm text-muted-foreground ml-2">Issue labels that trigger this category</span>
          </div>

          <div className="space-y-2">
            <code className="font-mono text-sm bg-muted px-2 py-0.5 rounded">infrastructure</code>
            <span className="text-sm text-muted-foreground ml-2">Setup/teardown commands for infra</span>
          </div>

          <div className="space-y-2">
            <code className="font-mono text-sm bg-muted px-2 py-0.5 rounded">requirements</code>
            <span className="text-sm text-muted-foreground ml-2">Requirements the AI should follow</span>
          </div>

          <div className="space-y-2">
            <code className="font-mono text-sm bg-muted px-2 py-0.5 rounded">deliverables</code>
            <span className="text-sm text-muted-foreground ml-2">What must be completed</span>
          </div>

          <div className="space-y-2">
            <code className="font-mono text-sm bg-muted px-2 py-0.5 rounded">testCommand</code>
            <span className="text-sm text-muted-foreground ml-2">Command to run tests</span>
          </div>
        </CardContent>
      </Card>

      {/* V1 Complete Example */}
      <Card className="border-muted">
        <CardHeader>
          <CardTitle className="text-muted-foreground">Version 1 Example</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="bg-muted p-4 rounded-md overflow-x-auto text-xs">
{`{
  "version": "1.0",
  "secondaryRepos": ["myorg/backend-api"],
  "categories": {
    "default": {
      "requirements": ["Must not break existing tests"],
      "deliverables": ["Fix the reported issue"],
      "testCommand": "npm test"
    },
    "database": {
      "match": { "labels": ["database", "db"] },
      "infrastructure": {
        "setup": "supabase start",
        "teardown": "supabase stop"
      },
      "requirements": ["Database migrations must be reversible"],
      "deliverables": ["Fix the database issue", "Add migration if needed"],
      "testCommand": "npm run test:db"
    }
  },
  "constraints": {
    "excludePaths": ["**/.env*"],
    "requireTests": true
  }
}`}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
