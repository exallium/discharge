'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import type { ProjectConfig } from '@/src/db/repositories/projects';

interface ProjectFormProps {
  project?: ProjectConfig;
  isNew?: boolean;
}

export function ProjectForm({ project, isNew = false }: ProjectFormProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form state
  const [id, setId] = useState(project?.id || '');
  const [repoFullName, setRepoFullName] = useState(project?.repoFullName || '');
  const [repo, setRepo] = useState(project?.repo || '');
  const [branch, setBranch] = useState(project?.branch || 'main');
  const [enabled, setEnabled] = useState(project?.enabled ?? true);

  // Triggers
  const [githubIssues, setGithubIssues] = useState(!!project?.triggers?.['github-issues']);
  const [sentry, setSentry] = useState(!!project?.triggers?.sentry);
  const [circleci, setCircleci] = useState(!!project?.triggers?.circleci);

  // Conversation mode
  const [conversationEnabled, setConversationEnabled] = useState(
    project?.conversation?.enabled ?? false
  );
  const [autoExecuteThreshold, setAutoExecuteThreshold] = useState(
    String(project?.conversation?.autoExecuteThreshold ?? 0.85)
  );
  const [maxIterations, setMaxIterations] = useState(
    String(project?.conversation?.maxIterations ?? 20)
  );
  const [routingTagPlan, setRoutingTagPlan] = useState(
    project?.conversation?.routingTags?.plan ?? 'ai:plan'
  );
  const [routingTagAuto, setRoutingTagAuto] = useState(
    project?.conversation?.routingTags?.auto ?? 'ai:auto'
  );
  const [routingTagAssist, setRoutingTagAssist] = useState(
    project?.conversation?.routingTags?.assist ?? 'ai:assist'
  );

  // Auto-fill clone URL from repo full name
  useEffect(() => {
    if (repoFullName && !repo) {
      setRepo(`https://github.com/${repoFullName}.git`);
    }
  }, [repoFullName, repo]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const triggers: Record<string, object> = {};
      if (githubIssues) triggers['github-issues'] = {};
      if (sentry) triggers.sentry = {};
      if (circleci) triggers.circleci = {};

      const data = {
        id,
        repoFullName,
        repo,
        branch,
        vcs: { type: 'github' as const },
        runner: { type: 'claude-code' as const },
        triggers,
        enabled,
        // Use null instead of undefined when disabled, so JSON.stringify includes the key
        // This signals to the API that conversation mode should be disabled
        conversation: conversationEnabled
          ? {
              enabled: true,
              autoExecuteThreshold: parseFloat(autoExecuteThreshold),
              maxIterations: parseInt(maxIterations),
              routingTags: {
                plan: routingTagPlan,
                auto: routingTagAuto,
                assist: routingTagAssist,
              },
            }
          : null,
      };

      const url = isNew ? '/api/projects' : `/api/projects/${project?.id}`;
      const method = isNew ? 'POST' : 'PUT';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to save project');
      }

      toast.success(isNew ? 'Project created' : 'Project updated');
      router.push('/projects');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save project');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this project?')) {
      return;
    }

    try {
      const response = await fetch(`/api/projects/${project?.id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete project');
      }

      toast.success('Project deleted');
      router.push('/projects');
      router.refresh();
    } catch (error) {
      toast.error('Failed to delete project');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Basic Info */}
      <Card>
        <CardHeader>
          <CardTitle>Basic Information</CardTitle>
          <CardDescription>Configure the repository and branch settings</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="id">Project ID</Label>
            <Input
              id="id"
              name="id"
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="my-project"
              required
              disabled={!isNew}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="repoFullName">Repository (owner/name)</Label>
            <Input
              id="repoFullName"
              name="repoFullName"
              value={repoFullName}
              onChange={(e) => setRepoFullName(e.target.value)}
              placeholder="owner/repository"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="repo">Clone URL</Label>
            <Input
              id="repo"
              name="repo"
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              placeholder="https://github.com/owner/repo.git"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="branch">Branch</Label>
            <Input
              id="branch"
              name="branch"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder="main"
              required
            />
          </div>

          {!isNew && (
            <div className="flex items-center space-x-2">
              <Switch id="enabled" name="enabled" checked={enabled} onCheckedChange={setEnabled} />
              <Label htmlFor="enabled">Enabled</Label>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Triggers */}
      <Card>
        <CardHeader>
          <CardTitle>Triggers</CardTitle>
          <CardDescription>Select which bug sources trigger this project</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="trigger-github-issues"
              value="github-issues"
              checked={githubIssues}
              onChange={(e) => setGithubIssues(e.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            <Label htmlFor="trigger-github-issues">GitHub Issues</Label>
          </div>

          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="trigger-sentry"
              value="sentry"
              checked={sentry}
              onChange={(e) => setSentry(e.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            <Label htmlFor="trigger-sentry">Sentry</Label>
          </div>

          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="trigger-circleci"
              value="circleci"
              checked={circleci}
              onChange={(e) => setCircleci(e.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            <Label htmlFor="trigger-circleci">CircleCI</Label>
          </div>
        </CardContent>
      </Card>

      {/* Conversation Mode */}
      <Card>
        <CardHeader>
          <CardTitle>Conversation Mode</CardTitle>
          <CardDescription>Enable interactive conversation-based bug fixing</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="conversationEnabled"
              checked={conversationEnabled}
              onChange={(e) => setConversationEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            <Label htmlFor="conversationEnabled">Enable Conversation Mode</Label>
          </div>

          <div id="conversationSettings" className={conversationEnabled ? '' : 'hidden'}>
            <div className="space-y-4 pt-4 border-t">
              <div className="space-y-2">
                <Label htmlFor="conversationAutoExecuteThreshold">Auto-Execute Threshold</Label>
                <Input
                  id="conversationAutoExecuteThreshold"
                  name="autoExecuteThreshold"
                  type="number"
                  step="0.01"
                  min="0"
                  max="1"
                  value={autoExecuteThreshold}
                  onChange={(e) => setAutoExecuteThreshold(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="conversationMaxIterations">Max Iterations</Label>
                <Input
                  id="conversationMaxIterations"
                  name="maxIterations"
                  type="number"
                  min="1"
                  max="100"
                  value={maxIterations}
                  onChange={(e) => setMaxIterations(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="routingTagPlan">Plan Review Tag</Label>
                <Input
                  id="routingTagPlan"
                  name="routingTagPlan"
                  value={routingTagPlan}
                  onChange={(e) => setRoutingTagPlan(e.target.value)}
                  placeholder="ai:plan"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="routingTagAuto">Auto Execute Tag</Label>
                <Input
                  id="routingTagAuto"
                  name="routingTagAuto"
                  value={routingTagAuto}
                  onChange={(e) => setRoutingTagAuto(e.target.value)}
                  placeholder="ai:auto"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="routingTagAssist">Assist Tag</Label>
                <Input
                  id="routingTagAssist"
                  name="routingTagAssist"
                  value={routingTagAssist}
                  onChange={(e) => setRoutingTagAssist(e.target.value)}
                  placeholder="ai:assist"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex items-center justify-between">
        <div>
          {!isNew && (
            <Button
              type="button"
              id="deleteBtn"
              variant="destructive"
              onClick={handleDelete}
            >
              Delete
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Saving...' : isNew ? 'Create Project' : 'Save Changes'}
          </Button>
        </div>
      </div>
    </form>
  );
}
