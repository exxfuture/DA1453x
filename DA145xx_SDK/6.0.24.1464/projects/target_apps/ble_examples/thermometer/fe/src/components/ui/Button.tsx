import { type ButtonHTMLAttributes, forwardRef } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from './cn';

export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'warm' | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'bg-primary-600 text-white hover:bg-primary-700 active:bg-primary-800 ' +
    'dark:bg-primary-400 dark:text-sand-950 dark:hover:bg-primary-300 dark:active:bg-primary-200',
  secondary:
    'border border-primary-600 text-primary-600 bg-transparent hover:bg-primary-50 active:bg-primary-100 ' +
    'dark:border-primary-300 dark:text-primary-300 dark:hover:bg-primary-950 dark:active:bg-primary-900',
  tertiary:
    'text-primary-600 bg-transparent hover:bg-primary-50 active:bg-primary-100 ' +
    'dark:text-primary-300 dark:hover:bg-primary-950 dark:active:bg-primary-900',
  warm: 'bg-ember-700 text-white hover:bg-ember-800 active:bg-ember-900',
  destructive: 'bg-garnet-600 text-white hover:bg-garnet-700 active:bg-garnet-800',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 text-body font-semibold rounded-md gap-1.5',
  md: 'h-touch px-4 text-body font-semibold rounded-md gap-2',
  lg: 'h-[52px] px-6 text-body-lg font-semibold rounded-md gap-2',
};

/**
 * Health-system Button — variants/sizes/states per design spec §4. `warm`
 * (Ember) is reserved for customer-facing encouragement CTAs; never use it
 * on doctor/admin pages (see spec §5 tone guidance).
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, disabled, className, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center transition-colors duration-fast ease-standard',
        'focus-visible:outline-none focus-visible:shadow-focus',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        'active:scale-[0.98]',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      )}
      {...props}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
});
