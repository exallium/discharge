import { PageHeader } from '@/components/layout/page-header';
import { ConfigReference } from './config-reference';

export default function DocsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Documentation"
        description="Learn how to configure AI Bug Fixer for your repositories"
      />
      <ConfigReference />
    </div>
  );
}
