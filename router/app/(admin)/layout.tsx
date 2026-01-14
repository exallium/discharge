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
    <div className="relative min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 container py-6">{children}</main>
      <footer className="border-t py-4">
        <div className="container flex items-center justify-between text-sm text-muted-foreground">
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
