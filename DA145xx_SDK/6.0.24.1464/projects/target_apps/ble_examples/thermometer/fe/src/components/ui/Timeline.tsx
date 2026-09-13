import type { LucideIcon } from 'lucide-react';
import { Circle } from 'lucide-react';
import { relativeTime } from '../../utils/time';
import { cn } from './cn';

export interface TimelineItem {
  id: string;
  icon?: LucideIcon;
  label: string;
  detail?: string;
  /** Epoch ms. */
  timestamp: number;
}

export interface TimelineProps {
  items: TimelineItem[];
  className?: string;
  /** Copy shown when there are no events. */
  emptyText?: string;
}

/**
 * Vertical list of dated events (consent grants, fever episodes, rollout
 * steps…). Items render in the order given — callers decide chronology.
 */
export function Timeline({ items, className, emptyText = 'Nothing here yet.' }: TimelineProps) {
  if (items.length === 0) {
    return <p className={cn('py-6 text-center text-body text-ink-muted', className)}>{emptyText}</p>;
  }

  return (
    <ol className={cn('space-y-0', className)}>
      {items.map((item, index) => {
        const Icon = item.icon ?? Circle;
        const isLast = index === items.length - 1;
        return (
          <li key={item.id} className="relative flex gap-3 pb-4 last:pb-0">
            {/* Rail: drawn per-item so it stops cleanly at the last dot. */}
            {!isLast && (
              <span
                className="absolute left-[15px] top-8 bottom-0 w-px bg-border-hairline dark:bg-border-hairline/[0.08]"
                aria-hidden
              />
            )}
            <span className="relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink-secondary">
              <Icon className="size-4" aria-hidden />
            </span>
            <div className="min-w-0 flex-1 pt-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="text-body font-semibold text-ink-primary">{item.label}</span>
                <time
                  className="text-caption text-ink-muted"
                  dateTime={new Date(item.timestamp).toISOString()}
                  title={new Date(item.timestamp).toLocaleString()}
                >
                  {relativeTime(item.timestamp)}
                </time>
              </div>
              {item.detail && <p className="mt-0.5 text-caption text-ink-secondary">{item.detail}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
