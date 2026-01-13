'use client';

import { useRouter } from 'next/navigation';
import { MoreVertical, Pencil, Power, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';

interface ProjectActionsProps {
  projectId: string;
  enabled: boolean;
}

export function ProjectActions({ projectId, enabled }: ProjectActionsProps) {
  const router = useRouter();

  const handleToggle = async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}/toggle`, {
        method: 'POST',
      });
      if (!response.ok) throw new Error('Failed to toggle project');
      toast.success(`Project ${enabled ? 'disabled' : 'enabled'}`);
      router.refresh();
    } catch {
      toast.error('Failed to toggle project');
    }
  };

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this project?')) return;

    try {
      const response = await fetch(`/api/projects/${projectId}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('Failed to delete project');
      toast.success('Project deleted');
      router.refresh();
    } catch {
      toast.error('Failed to delete project');
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8">
          <MoreVertical className="h-4 w-4" />
          <span className="sr-only">Open menu</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => router.push(`/projects/${projectId}`)}>
          <Pencil className="mr-2 h-4 w-4" />
          Edit
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleToggle}>
          <Power className="mr-2 h-4 w-4" />
          {enabled ? 'Disable' : 'Enable'}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={handleDelete}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
