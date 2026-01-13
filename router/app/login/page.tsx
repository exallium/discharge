// Force dynamic rendering - page checks database and session
export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';
import { getSession, isSetupRequired } from '@/lib/auth';
import { LoginForm } from './login-form';

export default async function LoginPage() {
  // Check if setup is required
  const needsSetup = await isSetupRequired();
  if (needsSetup) {
    redirect('/setup');
  }

  // Check if already logged in
  const session = await getSession();
  if (session.isLoggedIn) {
    redirect('/dashboard');
  }

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
          <h1 className="text-2xl font-bold">AI Bug Fixer</h1>
          <p className="text-muted-foreground">Sign in to your account</p>
        </div>
        <LoginForm />
      </div>
    </div>
  );
}
