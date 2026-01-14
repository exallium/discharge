// Force dynamic rendering - page fetches data from database
export const dynamic = 'force-dynamic';

import { PageHeader } from '@/components/layout/page-header';
import { settingsRepo } from '@/src/db/repositories';
import { SecuritySection } from './security-section';

export default async function SettingsPage() {
  // Fetch TOTP status server-side for initial render
  const totpEnabled = (await settingsRepo.get('totp:enabled')) === 'true';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Configure your AI Bug Fixer system"
      />

      <div className="grid gap-6">
        <SecuritySection initialTotpEnabled={totpEnabled} />
      </div>
    </div>
  );
}
