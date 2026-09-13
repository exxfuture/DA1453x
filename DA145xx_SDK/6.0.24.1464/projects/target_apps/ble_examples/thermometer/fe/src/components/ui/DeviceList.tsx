import { type ReactNode } from 'react';
import { Thermometer } from 'lucide-react';
import { cn } from './cn';

/**
 * Card-list presentation for devices — the shared alternative to raw tables
 * and unstyled lists wherever a customer faces their hardware (Devices page,
 * anywhere a claimed fleet is browsed). One row per device:
 *
 *   [icon tile]  Name            [badge]  [actions]
 *               mono bd-address
 *               meta caption line(s)
 *
 * Visual language follows spec §3/§4: `surface-1` cards with hairline
 * borders and `shadow-xs`, one accent at a time (the selected row gets the
 * primary edge), status carried by Badge (never color alone).
 */
export function DeviceList({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <ul role="list" className={cn('space-y-2', className)}>
      {children}
    </ul>
  );
}

export interface DeviceListItemProps {
  /** Secondary identity line — the BD address belongs here, in mono. */
  subtitle?: ReactNode;
  /** Caption-size metadata under the title (health line, claim date…). */
  meta?: ReactNode;
  /** Right-aligned action buttons. */
  actions?: ReactNode;
  /** Marks the row as the one currently in focus elsewhere (e.g. charted on the dashboard). */
  highlighted?: boolean;
  className?: string;
  children: ReactNode;
}

export function DeviceListItem({ subtitle, meta, actions, highlighted = false, className, children }: DeviceListItemProps) {
  return (
    <li
      className={cn(
        'flex items-start gap-3 rounded-lg border bg-surface-1 p-3.5 shadow-xs transition-colors duration-fast ease-standard',
        'dark:border-border-hairline/[0.08]',
        highlighted
          ? 'border-primary-300 dark:border-primary-500/60'
          : 'border-sand-200 hover:border-sand-300 dark:hover:border-border-hairline/[0.16]',
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md',
          highlighted ? 'bg-primary-100 text-primary-700 dark:bg-primary-900 dark:text-primary-300' : 'bg-surface-2 text-ink-secondary',
        )}
      >
        <Thermometer className="size-5" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-body font-semibold text-ink-primary">{children}</span>
          {subtitle && <span className="font-mono text-caption text-ink-muted">{subtitle}</span>}
        </div>
        {meta && <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-ink-muted">{meta}</div>}
      </div>

      {actions && <div className="flex shrink-0 items-center gap-1.5 self-center">{actions}</div>}
    </li>
  );
}
