'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface JobsListLiveProps {
  children: React.ReactNode;
}

/**
 * Client wrapper that adds real-time polling to the jobs list.
 * Polls every 10 seconds when the page is visible to fetch updates.
 */
export function JobsListLive({ children }: JobsListLiveProps) {
  const router = useRouter();

  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        router.refresh();
      }
    }, 10000); // 10 second polling

    return () => clearInterval(interval);
  }, [router]);

  return <>{children}</>;
}
