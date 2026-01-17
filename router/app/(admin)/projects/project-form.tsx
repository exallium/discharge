'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { ProjectSecrets } from '@/components/projects/project-secrets';
import { WebhookInfo } from '@/components/projects/webhook-info';
import { RepositoryPicker } from '@/components/projects/repository-picker';
import type { ProjectConfig } from '@/src/db/repositories/projects';

// Available Runner options (only show implemented ones)
const RUNNER_OPTIONS = [
  { value: 'claude-code', label: 'Claude Code' },
] as const;

type RunnerType = (typeof RUNNER_OPTIONS)[number]['value'];

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

interface ProjectFormProps {
  project?: ProjectConfig;
  isNew?: boolean;
}

export function ProjectForm({ project, isNew = false }: ProjectFormProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form state
  const [id, setId] = useState(project?.id || '');
  const [runnerType, setRunnerType] = useState<RunnerType>(
    (project?.runner?.type as RunnerType) || 'claude-code'
  );
  const [repoFullName, setRepoFullName] = useState(project?.repoFullName || '');
  const [repo, setRepo] = useState(project?.repo || '');
  const [branch, setBranch] = useState(project?.branch || 'main');
  const [enabled, setEnabled] = useState(project?.enabled ?? true);

  // Triggers
  const [githubIssues, setGithubIssues] = useState(!!project?.triggers?.github?.issues);
  const [sentry, setSentry] = useState(!!project?.triggers?.sentry?.enabled);
  const [circleci, setCircleci] = useState(!!project?.triggers?.circleci?.enabled);

  // Conversation mode settings
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

  // Handle repository selection from picker
  const handleRepoSelect = (selectedRepo: Repository) => {
    setRepoFullName(selectedRepo.fullName);
    setRepo(selectedRepo.cloneUrl);
    setBranch(selectedRepo.defaultBranch);
    // Auto-generate project ID from repo name if not set
    if (!id) {
      setId(selectedRepo.name.toLowerCase().replace(/[^a-z0-9-]/g, '-'));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      // Build triggers in the nested structure expected by trigger plugins
      const triggers: Record<string, object> = {};
      if (githubIssues) {
        triggers.github = { issues: true };
      }
      if (sentry) {
        triggers.sentry = { enabled: true };
      }
      if (circleci) {
        triggers.circleci = { enabled: true };
      }

      // Parse owner/repo from repoFullName (e.g., "owner/repo")
      const [vcsOwner, vcsRepo] = repoFullName.split('/');

      const data = {
        id,
        repoFullName,
        repo,
        branch,
        vcs: { type: 'github', owner: vcsOwner, repo: vcsRepo },
        runner: { type: runnerType },
        triggers,
        enabled,
        // Conversation mode settings (always included for triggers that support it)
        conversation: {
          autoExecuteThreshold: parseFloat(autoExecuteThreshold),
          maxIterations: parseInt(maxIterations),
          routingTags: {
            plan: routingTagPlan,
            auto: routingTagAuto,
            assist: routingTagAssist,
          },
        },
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
    } catch {
      toast.error('Failed to delete project');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Repository Selection - First for new projects */}
      {isNew && (
        <RepositoryPicker
          onSelect={handleRepoSelect}
          selectedRepo={repoFullName}
        />
      )}

      {/* Basic Info */}
      <Card>
        <CardHeader>
          <CardTitle>Project Configuration</CardTitle>
          <CardDescription>
            {isNew ? 'Configure your project settings' : 'Update project settings'}
          </CardDescription>
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
            <p className="text-xs text-muted-foreground">
              Unique identifier for this project. Cannot be changed after creation.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="repoFullName">Repository (owner/repo)</Label>
            <Input
              id="repoFullName"
              name="repoFullName"
              value={repoFullName}
              onChange={(e) => setRepoFullName(e.target.value)}
              placeholder="owner/repository"
              required
              disabled={isNew} // Disabled for new - use picker
            />
            {!isNew && (
              <p className="text-xs text-muted-foreground">
                Repository cannot be changed. Create a new project for a different repository.
              </p>
            )}
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
            <Label htmlFor="branch">Default Branch</Label>
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

      {/* Runner Configuration */}
      <Card>
        <CardHeader>
          <CardTitle>AI Runner</CardTitle>
          <CardDescription>Select the AI agent that will investigate and fix bugs</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="runnerType">Runner</Label>
            <Select value={runnerType} onValueChange={(v) => setRunnerType(v as RunnerType)}>
              <SelectTrigger id="runnerType">
                <SelectValue placeholder="Select AI runner" />
              </SelectTrigger>
              <SelectContent>
                {RUNNER_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Runs Claude Code in Docker to analyze code and create fixes.
            </p>
          </div>
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

      {/* Conversation Mode Settings */}
      <Card>
        <CardHeader>
          <CardTitle>Conversation Settings</CardTitle>
          <CardDescription>Configure how the AI interacts with issues and PRs</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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
            <p className="text-xs text-muted-foreground">
              Confidence score (0-1) required to auto-execute without plan review. Default: 0.85
            </p>
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
            <p className="text-xs text-muted-foreground">
              Maximum conversation rounds before stopping. Default: 20
            </p>
          </div>

          {/* Routing Tags - only shown when GitHub Issues trigger is enabled */}
          {githubIssues && (
            <div className="space-y-2 pt-4 border-t">
              <h4 className="text-sm font-medium">Routing Tags (GitHub Labels)</h4>
              <p className="text-xs text-muted-foreground mb-4">
                GitHub labels that control how issues are processed. Add these labels to issues to override confidence-based routing.
              </p>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="routingTagPlan">Plan Review</Label>
                  <Input
                    id="routingTagPlan"
                    name="routingTagPlan"
                    value={routingTagPlan}
                    onChange={(e) => setRoutingTagPlan(e.target.value)}
                    placeholder="ai:plan"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="routingTagAuto">Auto Execute</Label>
                  <Input
                    id="routingTagAuto"
                    name="routingTagAuto"
                    value={routingTagAuto}
                    onChange={(e) => setRoutingTagAuto(e.target.value)}
                    placeholder="ai:auto"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="routingTagAssist">Assist Only</Label>
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
          )}
        </CardContent>
      </Card>

      {/* Secrets - only show when editing existing project */}
      {!isNew && project?.id && (
        <ProjectSecrets
          projectId={project.id}
          enabledTriggers={[
            ...(githubIssues ? ['github-issues'] : []),
            ...(sentry ? ['sentry'] : []),
            ...(circleci ? ['circleci'] : []),
          ]}
        />
      )}

      {/* Webhook URLs - only show when editing and triggers are enabled */}
      {!isNew && (githubIssues || sentry || circleci) && (
        <WebhookInfo
          enabledTriggers={[
            ...(githubIssues ? ['github-issues'] : []),
            ...(sentry ? ['sentry'] : []),
            ...(circleci ? ['circleci'] : []),
          ]}
        />
      )}

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
          <Button type="submit" disabled={isSubmitting || (isNew && !repoFullName)}>
            {isSubmitting ? 'Saving...' : isNew ? 'Create Project' : 'Save Changes'}
          </Button>
        </div>
      </div>
    </form>
  );
}
