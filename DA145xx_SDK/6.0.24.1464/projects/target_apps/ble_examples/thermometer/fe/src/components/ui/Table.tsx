import { type ReactNode, type TdHTMLAttributes, type ThHTMLAttributes } from 'react';
import { cn } from './cn';

/** Dense, clinical table primitives — see design spec §4 "Table". No zebra
 *  striping; hairline row dividers read cleaner. Wrap in a horizontally
 *  scrollable container so wide tables never blow out the page on mobile. */
export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className={cn('w-full min-w-[32rem] border-collapse text-body', className)}>{children}</table>
    </div>
  );
}

export function TableHead({ children }: { children: ReactNode }) {
  return <thead className="sticky top-0 z-10 bg-surface-1">{children}</thead>;
}

export function TableHeadRow({ children }: { children: ReactNode }) {
  return <tr className="border-b border-border-hairline dark:border-border-hairline/[0.08]">{children}</tr>;
}

export function TableHeadCell({ className, children, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn('py-2.5 px-3 text-left text-label uppercase tracking-wide text-ink-muted font-semibold', className)}
      {...props}
    >
      {children}
    </th>
  );
}

export function TableBody({ children }: { children: ReactNode }) {
  return <tbody>{children}</tbody>;
}

export function TableRow({
  selected,
  className,
  children,
}: {
  selected?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <tr
      className={cn(
        'h-11 border-b border-border-hairline dark:border-border-hairline/[0.08] transition-colors duration-fast ease-standard',
        selected
          ? 'bg-primary-50 dark:bg-primary-950 border-l-[3px] border-l-primary-600'
          : 'hover:bg-sand-50 dark:hover:bg-surface-2',
        className,
      )}
    >
      {children}
    </tr>
  );
}

export function TableCell({ className, mono, muted, children, ...props }: TdHTMLAttributes<HTMLTableCellElement> & {
  mono?: boolean;
  muted?: boolean;
}) {
  return (
    <td
      className={cn(
        'px-3 py-2 align-middle',
        mono && 'font-mono text-mono-sm font-tabular',
        muted && 'text-ink-secondary',
        className,
      )}
      {...props}
    >
      {children}
    </td>
  );
}
