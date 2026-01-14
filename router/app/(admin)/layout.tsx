// Force dynamic rendering - layout checks database for setup status
export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';
import { Header } from '@/components/layout/header';
import { Toaster } from '@/components/ui/sonner';
import { isSetupRequired } from '@/lib/auth';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Check if setup is required
  const setupRequired = await isSetupRequired();
  if (setupRequired) {
    redirect('/setup');
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <Header />
      <main className="flex-1 overflow-auto">
        <div className="container mx-auto max-w-7xl px-6 py-6">{children}</div>
      </main>
      <footer className="border-t py-3 shrink-0">
        <div className="container mx-auto max-w-7xl px-6 flex items-center justify-between text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <span className="flex h-2 w-2 rounded-full bg-success" />
            System healthy
          </div>
          <span>v1.0.0</span>
        </div>
      </footer>
      <Toaster />
    </div>
  );
}
