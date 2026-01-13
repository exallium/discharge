// Force dynamic rendering - page fetches data from database
export const dynamic = 'force-dynamic';

import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { ProjectForm } from '../project-form';
import { projectsRepo } from '@/src/db/repositories';

interface EditProjectPageProps {
  params: Promise<{ id: string }>;
}

export default async function EditProjectPage({ params }: EditProjectPageProps) {
  const { id } = await params;
  const project = await projectsRepo.findById(id);

  if (!project) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Edit Project"
        description={`Configure settings for ${project.repoFullName}`}
      />
      <ProjectForm project={project} />
    </div>
  );
}
