import { Button } from './Button';
import { cn } from './cn';

export interface SegmentedProps<T extends string> {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  /** Accessible name for the group — the buttons alone don't say what they switch. */
  label: string;
  className?: string;
}

/**
 * Mutually exclusive view switch, styled like the range pickers on the doctor
 * pages so the two read as the same control.
 *
 * Moved out of pages/admin/AdminUi.tsx into the shared kit (review FE-26): it is
 * a generic control, and generic controls living under pages/admin/ is what made
 * the doctor pages reinvent their own instead of reusing it.
 */
export function Segmented<T extends string>({ options, value, onChange, label, className }: SegmentedProps<T>) {
  return (
    <div role="group" aria-label={label} className={cn('flex flex-wrap gap-1', className)}>
      {options.map((option) => (
        <Button
          key={option.value}
          type="button"
          size="sm"
          variant={option.value === value ? 'primary' : 'tertiary'}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}
