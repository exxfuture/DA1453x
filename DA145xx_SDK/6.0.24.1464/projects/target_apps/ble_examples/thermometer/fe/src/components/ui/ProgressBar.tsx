import { cn } from './cn';

export type ProgressVariant = 'default' | 'success' | 'warning' | 'danger';

export interface ProgressBarProps {
  value: number;
  max: number;
  variant?: ProgressVariant;
  /** Accessible name — required whenever the surrounding copy doesn't name it. */
  label?: string;
  className?: string;
}

const FILL_CLASSES: Record<ProgressVariant, string> = {
  default: 'bg-primary-600 dark:bg-primary-400',
  success: 'bg-success-text',
  warning: 'bg-warning-text',
  danger: 'bg-danger-text',
};

/** Determinate progress meter (rollout completion, quota usage, …). */
export function ProgressBar({ value, max, variant = 'default', label, className }: ProgressBarProps) {
  // Guard the degenerate cases so a bad denominator can't produce NaN width.
  const percent = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(percent)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuetext={`${value} of ${max}`}
      className={cn('h-2 w-full overflow-hidden rounded-full bg-sand-100 dark:bg-surface-2', className)}
    >
      <div
        className={cn('h-full rounded-full transition-[width] duration-base ease-standard', FILL_CLASSES[variant])}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
