import { type HTMLAttributes, type ReactNode } from 'react';
import { cn } from './cn';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Doctor/admin pages use tighter padding — see spec §3 density rule. */
  density?: 'comfortable' | 'compact';
  header?: ReactNode;
  footer?: ReactNode;
}

const PADDING = {
  comfortable: 'p-5 sm:p-6',
  compact: 'p-4',
};

export function Card({ density = 'comfortable', header, footer, className, children, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-lg bg-surface-1 shadow-sm dark:shadow-none dark:border dark:border-border-hairline/[0.08]',
        className,
      )}
      {...props}
    >
      {header && (
        <div className={cn('border-b border-border-hairline dark:border-border-hairline/[0.08]', PADDING[density])}>
          {header}
        </div>
      )}
      <div className={PADDING[density]}>{children}</div>
      {footer && (
        <div
          className={cn(
            'border-t border-border-hairline dark:border-border-hairline/[0.08] flex justify-end gap-2',
            PADDING[density],
          )}
        >
          {footer}
        </div>
      )}
    </div>
  );
}
