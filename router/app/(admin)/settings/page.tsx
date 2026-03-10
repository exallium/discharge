// Force dynamic rendering - page fetches data from database
export const dynamic = 'force-dynamic';

import { PageHeader } from '@/components/layout/page-header';
import { settingsRepo } from '@/src/db/repositories';
import { SecuritySection } from './security-section';
import { GitHubAppSection } from './github-app-section';
import { PasswordSection } from './password-section';
import { ApiTokensSection } from './api-tokens-section';

export default async function SettingsPage() {
  // Fetch TOTP status server-side for initial render
  const totpEnabled = (await settingsRepo.get('totp:enabled')) === 'true';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Configure your Discharge system"
      />

      <div className="grid gap-6">
        <GitHubAppSection />
        <ApiTokensSection />
        <PasswordSection />
        <SecuritySection initialTotpEnabled={totpEnabled} />
      </div>
    </div>
  );
}
