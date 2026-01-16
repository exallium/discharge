'use client';

import { useRouter, useSearchParams } from 'next/navigation';

interface JobsFiltersProps {
  projects: Array<{ id: string; repoFullName: string }>;
  currentProject?: string;
  currentTab: string;
}

export function JobsFilters({ projects, currentProject, currentTab }: JobsFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const handleProjectChange = (projectId: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (projectId) {
      params.set('project', projectId);
    } else {
      params.delete('project');
    }
    params.set('tab', currentTab);
    params.delete('page'); // Reset to page 1 when filter changes
    router.push(`/jobs?${params.toString()}`);
  };

  return (
    <div className="mb-4 flex items-center gap-4">
      <select
        className="rounded-md border border-input bg-background px-3 py-2 text-sm"
        value={currentProject || ''}
        onChange={(e) => handleProjectChange(e.target.value)}
      >
        <option value="">All projects</option>
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.repoFullName}
          </option>
        ))}
      </select>
    </div>
  );
}
