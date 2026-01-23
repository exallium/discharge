// Force dynamic rendering - page checks database and session
export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';
import { getSession, isFirstRun } from '@/lib/auth';
import { LoginForm } from './login-form';

interface LoginPageProps {
  searchParams: Promise<{ setup?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { setup } = await searchParams;

  // Check if already logged in
  const session = await getSession();
  if (session.isLoggedIn) {
    // If setup mode, go to setup page; otherwise dashboard
    if (setup === 'true') {
      redirect('/setup');
    }
    redirect('/dashboard');
  }

  // Check if this is first run (no password configured anywhere)
  const firstRun = await isFirstRun();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-full max-w-sm space-y-6 p-6">
        <div className="text-center space-y-2">
          <div className="flex justify-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary">
              <svg
                className="h-8 w-8 text-primary-foreground"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                />
              </svg>
            </div>
          </div>
          <h1 className="text-2xl font-bold">Discharge</h1>
          {firstRun ? (
            <p className="text-muted-foreground">
              Check the server console for your temporary password
            </p>
          ) : (
            <p className="text-muted-foreground">Sign in to your account</p>
          )}
        </div>
        {firstRun && (
          <div className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
            <p className="font-medium">First Run Setup</p>
            <p className="mt-1">
              Username: <code className="bg-background px-1 rounded">admin</code>
            </p>
            <p>
              Password: <code className="bg-background px-1 rounded">check server logs</code>
            </p>
          </div>
        )}
        <LoginForm redirectTo={firstRun ? '/setup' : '/dashboard'} />
      </div>
    </div>
  );
}
