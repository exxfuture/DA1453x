import { type ReactNode } from 'react';
import { AlertOctagon, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { cn } from './cn';

export type AlertStatus = 'success' | 'warning' | 'danger' | 'info';

const STATUS_CLASSES: Record<AlertStatus, string> = {
  success: 'bg-success-tint text-success-text border-success-border',
  warning: 'bg-warning-tint text-warning-text border-warning-border',
  danger: 'bg-danger-tint text-danger-text border-danger-border',
  info: 'bg-info-tint text-info-text border-info-border',
};

const STATUS_ICON: Record<AlertStatus, ReactNode> = {
  success: <CheckCircle2 className="size-5 shrink-0" aria-hidden />,
  warning: <AlertTriangle className="size-5 shrink-0" aria-hidden />,
  danger: <AlertOctagon className="size-5 shrink-0" aria-hidden />,
  info: <Info className="size-5 shrink-0" aria-hidden />,
};

export interface AlertProps {
  status?: AlertStatus;
  children: ReactNode;
  onDismiss?: () => void;
  className?: string;
}

/** Persistent inline banner — see design spec §4 "Toast/Alert". */
export function Alert({ status = 'info', children, onDismiss, className }: AlertProps) {
  return (
    <div
      role={status === 'danger' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-2.5 rounded-md border border-l-4 p-3 text-body',
        STATUS_CLASSES[status],
        className,
      )}
    >
      {STATUS_ICON[status]}
      <div className="flex-1">{children}</div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="rounded-md p-1 hover:bg-black/5 dark:hover:bg-white/10 focus-visible:outline-none focus-visible:shadow-focus"
        >
          <X className="size-4" aria-hidden />
        </button>
      )}
    </div>
  );
}
