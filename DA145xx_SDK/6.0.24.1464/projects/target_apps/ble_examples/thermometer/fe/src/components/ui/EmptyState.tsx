import { type ComponentType, type ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';
import { Button } from './Button';
import { cn } from './cn';

export interface EmptyStateProps {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description?: ReactNode;
  action?: { label: string; onClick: () => void };
  className?: string;
}

/** Shared empty-state pattern — see design spec §4. Copy tone follows the
 *  page's audience (warm for customer pages, terse for doctor/admin). */
export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('mx-auto flex max-w-[22rem] flex-col items-center gap-2 py-10 text-center', className)}>
      <Icon className="size-12 text-sand-400 dark:text-sand-600" />
      <h3 className="text-h3 font-semibold text-ink-primary">{title}</h3>
      {description && <p className="text-body text-ink-secondary">{description}</p>}
      {action && (
        <Button variant="secondary" size="sm" className="mt-2" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}

/** Content-shaped skeleton shimmer — reserve spinners for inline/button loading only. */
export function SkeletonBlock({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'animate-pulse rounded-md bg-gradient-to-r from-sand-100 to-sand-200 dark:from-surface-2 dark:to-surface-3 motion-reduce:animate-none',
        className,
      )}
    />
  );
}

export function ErrorState({ message = 'Something went wrong.', onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div className="mx-auto flex max-w-[22rem] flex-col items-center gap-2 py-10 text-center">
      <AlertCircle className="size-12 text-danger-text" />
      <h3 className="text-h3 font-semibold text-ink-primary">Something went wrong</h3>
      <p className="text-body text-ink-secondary">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-2" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
