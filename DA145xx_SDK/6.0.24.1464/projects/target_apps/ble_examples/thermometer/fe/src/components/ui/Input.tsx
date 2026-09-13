import { type InputHTMLAttributes, forwardRef, useId } from 'react';
import { AlertCircle } from 'lucide-react';
import { cn } from './cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  helperText?: string;
  errorText?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, helperText, errorText, id, className, ...props },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const hasError = Boolean(errorText);

  return (
    <div className="space-y-1.5">
      {label && (
        <label htmlFor={inputId} className="block text-label uppercase tracking-wide text-ink-secondary">
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={inputId}
        aria-invalid={hasError || undefined}
        aria-describedby={helperText || errorText ? `${inputId}-hint` : undefined}
        className={cn(
          'h-touch w-full rounded-md border bg-surface-1 px-3 text-body text-ink-primary',
          'transition-colors duration-fast ease-standard',
          'placeholder:text-ink-muted',
          'focus-visible:outline-none focus-visible:border-primary-600 focus-visible:shadow-focus dark:focus-visible:border-primary-300',
          'disabled:cursor-not-allowed disabled:bg-sand-50 disabled:text-sand-400 dark:disabled:bg-surface-2',
          hasError
            ? 'border-danger-text'
            : 'border-sand-500 hover:border-sand-600 dark:border-sand-600 dark:hover:border-sand-400',
          className,
        )}
        {...props}
      />
      {(helperText || errorText) && (
        <p
          id={`${inputId}-hint`}
          className={cn('flex items-center gap-1 text-caption', hasError ? 'text-danger-text' : 'text-ink-muted')}
        >
          {hasError && <AlertCircle className="size-3.5 shrink-0" aria-hidden />}
          {errorText ?? helperText}
        </p>
      )}
    </div>
  );
});
