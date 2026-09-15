import { type SelectHTMLAttributes, forwardRef, useId } from 'react';
import { cn } from './cn';

/**
 * The native `size` attribute (how many rows a multi-line select shows) is
 * omitted and the name reused for the design system's control scale, matching
 * Button and Input. Nothing here needs a multi-row select.
 */
export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  label?: string;
  helperText?: string;
  /**
   * `md` (h-touch, full width) is the form control; `sm` (h-9, intrinsic width)
   * matches a `size="sm"` Button so a select can sit in a toolbar row.
   */
  size?: 'sm' | 'md';
}

/**
 * Native `<select>` with the design system's field styling — the Input
 * counterpart for a choice out of a fixed list.
 *
 * Added because the identical long Tailwind class string had been retyped at six
 * call sites (review FE-17), which made a token change to radius or border
 * colour a six-file edit. Native rather than a custom listbox on purpose: it
 * gets mobile's wheel picker, keyboard type-ahead and the platform's own focus
 * behaviour for free, which a hand-rolled popup would all have to reimplement.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, helperText, size = 'md', id, className, children, ...props },
  ref,
) {
  const autoId = useId();
  const selectId = id ?? autoId;

  const field = (
    <select
      ref={ref}
      id={selectId}
      aria-describedby={helperText ? `${selectId}-hint` : undefined}
      className={cn(
        'cursor-pointer rounded-md border border-sand-500 bg-surface-1 text-body text-ink-primary',
        'transition-colors duration-fast ease-standard',
        'hover:border-sand-600 dark:border-sand-600 dark:hover:border-sand-400',
        'focus-visible:outline-none focus-visible:border-primary-600 focus-visible:shadow-focus dark:focus-visible:border-primary-300',
        'disabled:cursor-not-allowed disabled:bg-sand-50 disabled:text-sand-400 dark:disabled:bg-surface-2',
        size === 'sm' ? 'h-9 px-2' : 'h-touch w-full px-3',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );

  // An unlabelled select needs no wrapper div — callers in toolbars rely on it
  // being a bare control they can place in a flex row (and pass aria-label).
  if (!label && !helperText) return field;

  return (
    <div className="space-y-1.5">
      {label && (
        <label htmlFor={selectId} className="block text-label uppercase tracking-wide text-ink-secondary">
          {label}
        </label>
      )}
      {field}
      {helperText && (
        <p id={`${selectId}-hint`} className="text-caption text-ink-muted">
          {helperText}
        </p>
      )}
    </div>
  );
});
