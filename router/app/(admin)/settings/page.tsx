// Force dynamic rendering - page fetches data from database
export const dynamic = 'force-dynamic';

import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { settingsRepo } from '@/src/db/repositories';

export default async function SettingsPage() {
  // Get current settings - the key format is "category:key"
  const githubToken = await settingsRepo.get('github:token');
  const githubWebhookSecret = await settingsRepo.get('github:webhook_secret');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Configure your AI Bug Fixer system"
      />

      <div className="grid gap-6">
        {/* GitHub Settings */}
        <Card>
          <CardHeader>
            <CardTitle>GitHub</CardTitle>
            <CardDescription>
              Configure GitHub integration settings
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="github-token">GitHub Token</Label>
              <Input
                id="github-token"
                type="password"
                placeholder="ghp_xxxxxxxxxxxx"
                defaultValue={githubToken ? '••••••••••••••••' : ''}
              />
              <p className="text-sm text-muted-foreground">
                Personal access token with repo access
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="webhook-secret">Webhook Secret</Label>
              <Input
                id="webhook-secret"
                type="password"
                placeholder="your-webhook-secret"
                defaultValue={githubWebhookSecret ? '••••••••••••••••' : ''}
              />
              <p className="text-sm text-muted-foreground">
                Secret used to verify webhook signatures
              </p>
            </div>
            <Button>Save GitHub Settings</Button>
          </CardContent>
        </Card>

        {/* Password Change */}
        <Card>
          <CardHeader>
            <CardTitle>Security</CardTitle>
            <CardDescription>
              Manage admin password
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="current-password">Current Password</Label>
              <Input id="current-password" type="password" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-password">New Password</Label>
              <Input id="new-password" type="password" />
              <p className="text-sm text-muted-foreground">
                Minimum 12 characters
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm New Password</Label>
              <Input id="confirm-password" type="password" />
            </div>
            <Button variant="secondary">Change Password</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
