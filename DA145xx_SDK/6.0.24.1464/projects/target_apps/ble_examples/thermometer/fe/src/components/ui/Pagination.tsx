import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './Button';
import { cn } from './cn';

export interface PaginationProps {
  /** 1-based. */
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  className?: string;
}

/** Prev/next pager for the paginated admin lists. Renders nothing for a single page. */
export function Pagination({ page, totalPages, onPageChange, className }: PaginationProps) {
  if (totalPages <= 1) return null;

  const current = Math.min(Math.max(page, 1), totalPages);

  return (
    <nav className={cn('flex items-center justify-between gap-2', className)} aria-label="Pagination">
      <Button
        size="sm"
        variant="tertiary"
        onClick={() => onPageChange(current - 1)}
        disabled={current <= 1}
        aria-label="Previous page"
      >
        <ChevronLeft className="size-4" aria-hidden />
        Previous
      </Button>
      <span className="text-caption text-ink-muted" aria-live="polite">
        Page <span className="font-tabular font-semibold text-ink-primary">{current}</span> of{' '}
        <span className="font-tabular">{totalPages}</span>
      </span>
      <Button
        size="sm"
        variant="tertiary"
        onClick={() => onPageChange(current + 1)}
        disabled={current >= totalPages}
        aria-label="Next page"
      >
        Next
        <ChevronRight className="size-4" aria-hidden />
      </Button>
    </nav>
  );
}
