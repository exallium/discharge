import { PageHeader } from '@/components/layout/page-header';
import { ProjectForm } from '../project-form';

export default function NewProjectPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="New Project"
        description="Add a new repository for Discharge"
      />
      <ProjectForm isNew />
    </div>
  );
}
