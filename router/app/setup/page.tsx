// Force dynamic rendering - checks setup status
export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';
import { isSetupRequired, getSession } from '@/lib/auth';
import { SetupForm } from './setup-form';

export default async function SetupPage() {
  // Check if setup is needed
  const setupRequired = await isSetupRequired();

  if (!setupRequired) {
    // Setup already complete, redirect to dashboard
    redirect('/dashboard');
  }

  // Check if user is logged in
  const session = await getSession();
  if (!session.isLoggedIn) {
    // Need to login first with generated password
    redirect('/login?setup=true');
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-md space-y-8 p-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight">Welcome</h1>
          <p className="mt-2 text-muted-foreground">
            Set up your admin credentials to get started.
          </p>
        </div>

        <SetupForm />
      </div>
    </div>
  );
}
