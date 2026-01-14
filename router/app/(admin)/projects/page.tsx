// Force dynamic rendering - page fetches data from database
export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { Plus } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { projectsRepo } from '@/src/db/repositories';
import { ProjectActions } from './project-actions';
import { ShowDisabledFilter } from './show-disabled-filter';

interface ProjectsPageProps {
  searchParams: Promise<{ includeDisabled?: string }>;
}

export default async function ProjectsPage({ searchParams }: ProjectsPageProps) {
  const { includeDisabled: includeDisabledParam } = await searchParams;
  const includeDisabled = includeDisabledParam === 'true';
  const projects = await projectsRepo.findAll(includeDisabled);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Projects"
        description="Manage your repository configurations"
      >
        <Button asChild>
          <Link href="/projects/new">
            <Plus className="mr-2 h-4 w-4" />
            Add Project
          </Link>
        </Button>
      </PageHeader>

      <Card>
        <CardContent className="pt-6">
          {/* Filter */}
          <div className="mb-4 flex items-center gap-2">
            <ShowDisabledFilter />
          </div>

          {projects.length === 0 ? (
            <EmptyState
              title="No projects yet"
              description="Add your first repository to start fixing bugs automatically."
              action={{
                label: 'Add Project',
                href: '/projects/new',
              }}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Repository</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Triggers</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[70px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {projects.map((project) => (
                  <TableRow key={project.id}>
                    <TableCell>
                      <div>
                        <Link
                          href={`/projects/${project.id}`}
                          className="font-medium hover:underline"
                        >
                          {project.repoFullName}
                        </Link>
                        <div className="text-sm text-muted-foreground">
                          {project.id}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {project.branch}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {Object.keys(project.triggers).map((trigger) => (
                          <Badge key={trigger} variant="outline" className="text-xs">
                            {trigger}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      {project.enabled ? (
                        <Badge variant="success">Active</Badge>
                      ) : (
                        <Badge variant="secondary">Disabled</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <ProjectActions projectId={project.id} enabled={project.enabled} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
