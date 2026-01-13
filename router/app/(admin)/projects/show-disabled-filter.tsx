'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function ShowDisabledFilterInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const includeDisabled = searchParams.get('includeDisabled') === 'true';

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.checked;
    const params = new URLSearchParams(searchParams.toString());

    if (newValue) {
      params.set('includeDisabled', 'true');
    } else {
      params.delete('includeDisabled');
    }

    router.push(`/projects?${params.toString()}`);
  };

  return (
    <label className="flex items-center gap-2 text-sm text-muted-foreground">
      <input
        type="checkbox"
        checked={includeDisabled}
        onChange={handleChange}
        className="rounded border-input"
      />
      Show disabled
    </label>
  );
}

export function ShowDisabledFilter() {
  return (
    <Suspense
      fallback={
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            disabled
            className="rounded border-input"
          />
          Show disabled
        </label>
      }
    >
      <ShowDisabledFilterInner />
    </Suspense>
  );
}
