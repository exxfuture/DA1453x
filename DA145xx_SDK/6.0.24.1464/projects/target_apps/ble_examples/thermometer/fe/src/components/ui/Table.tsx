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

/**
 * Plain (non-sticky) header — review FE-23, resolved differently than
 * recommended.
 *
 * The header used to carry `sticky top-0 z-10`. Because `Table` wraps the
 * table in an `overflow-x-auto` div, that div — not the page — is the
 * header's scroll container, so `sticky` was inert (the wrapper never scrolls
 * vertically) and the overlap with the `h-16` NavBar the review described
 * could not actually occur. Offsetting it to `top-16` instead pins the header
 * 64px *inside the wrapper*, permanently covering the first data rows (it
 * intercepted the "View" link on the doctor dashboard in the e2e suite).
 * A page-sticky header would need the wrapper to stop being a scroll
 * container (breaking horizontal scrolling of wide tables on mobile) or a
 * bounded-height table box with its own vertical scroll; neither is worth it
 * for the current table lengths, so the header simply scrolls with the page.
 */
export function TableHead({ children }: { children: ReactNode }) {
  return <thead className="bg-surface-1">{children}</thead>;
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
