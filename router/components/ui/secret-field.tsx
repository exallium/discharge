'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Eye, EyeOff, Copy, Check, Pencil, Trash2, X, Save } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface SecretFieldProps {
  value?: string;
  masked: string;
  source: 'project' | 'global' | 'env' | 'none';
  onSave?: (value: string) => Promise<void>;
  onDelete?: () => Promise<void>;
  disabled?: boolean;
}

export function SecretField({
  value,
  masked,
  source,
  onSave,
  onDelete,
  disabled = false,
}: SecretFieldProps) {
  const [isRevealed, setIsRevealed] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const hasValue = source !== 'none' && value;
  const isOverridable = source === 'global' || source === 'env';
  const canDelete = source === 'project';

  const handleCopy = async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setIsCopied(true);
      toast.success('Copied to clipboard');
      setTimeout(() => setIsCopied(false), 2000);
    } catch {
      toast.error('Failed to copy');
    }
  };

  const handleStartEdit = () => {
    setEditValue('');
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditValue('');
  };

  const handleSave = async () => {
    if (!editValue.trim() || !onSave) return;
    setIsSaving(true);
    try {
      await onSave(editValue.trim());
      setIsEditing(false);
      setEditValue('');
      toast.success('Secret saved');
    } catch {
      toast.error('Failed to save secret');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!onDelete) return;
    if (!confirm('Remove this project-specific secret? It will fall back to global/env if available.')) {
      return;
    }
    try {
      await onDelete();
      toast.success('Secret removed');
    } catch {
      toast.error('Failed to remove secret');
    }
  };

  if (isEditing) {
    return (
      <div className="flex items-center gap-2">
        <Input
          type="password"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          placeholder="Enter new value..."
          className="font-mono text-sm h-8"
          autoFocus
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={handleSave}
          disabled={!editValue.trim() || isSaving}
        >
          <Save className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={handleCancelEdit}
          disabled={isSaving}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  if (!hasValue) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground italic">Not configured</span>
        {onSave && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={handleStartEdit}
            disabled={disabled}
          >
            + Add
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <code
        className={cn(
          'text-sm font-mono bg-muted px-2 py-1 rounded flex-1 min-w-0 truncate',
          !isRevealed && 'tracking-wider'
        )}
      >
        {isRevealed ? value : masked}
      </code>

      <div className="flex items-center gap-1 shrink-0">
        {/* Reveal toggle */}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => setIsRevealed(!isRevealed)}
          title={isRevealed ? 'Hide' : 'Reveal'}
        >
          {isRevealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </Button>

        {/* Copy */}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={handleCopy}
          title="Copy to clipboard"
        >
          {isCopied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
        </Button>

        {/* Override (for global/env) or Edit (for project) */}
        {onSave && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={handleStartEdit}
            disabled={disabled}
            title={isOverridable ? 'Override with project-specific value' : 'Edit'}
          >
            <Pencil className="h-4 w-4" />
          </Button>
        )}

        {/* Delete (only for project-specific) */}
        {canDelete && onDelete && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-destructive hover:text-destructive"
            onClick={handleDelete}
            disabled={disabled}
            title="Remove project override"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
