import { cn } from '@/lib/utils';
import { Badge } from './badge';
import {
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  AlertCircle,
} from 'lucide-react';

type Status = 'success' | 'error' | 'pending' | 'running' | 'warning';

interface StatusBadgeProps {
  status: Status;
  label?: string;
  showIcon?: boolean;
  className?: string;
}

const statusConfig: Record<
  Status,
  {
    variant: 'default' | 'success' | 'destructive' | 'secondary' | 'warning';
    icon: typeof CheckCircle2;
    defaultLabel: string;
  }
> = {
  success: {
    variant: 'success',
    icon: CheckCircle2,
    defaultLabel: 'Success',
  },
  error: {
    variant: 'destructive',
    icon: XCircle,
    defaultLabel: 'Failed',
  },
  pending: {
    variant: 'secondary',
    icon: Clock,
    defaultLabel: 'Pending',
  },
  running: {
    variant: 'default',
    icon: Loader2,
    defaultLabel: 'Running',
  },
  warning: {
    variant: 'warning',
    icon: AlertCircle,
    defaultLabel: 'Warning',
  },
};

export function StatusBadge({
  status,
  label,
  showIcon = true,
  className,
}: StatusBadgeProps) {
  const config = statusConfig[status];
  const Icon = config.icon;
  const displayLabel = label || config.defaultLabel;

  return (
    <Badge variant={config.variant} className={cn('gap-1', className)}>
      {showIcon && (
        <Icon
          className={cn(
            'h-3 w-3',
            status === 'running' && 'animate-spin'
          )}
        />
      )}
      {displayLabel}
    </Badge>
  );
}
