import { useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { relativeTime } from '../utils/time';
import { Button } from './ui/Button';
import { cn } from './ui/cn';

export interface ThreadNote {
  id: string;
  author?: string;
  note: string;
  /** Epoch ms. */
  createdAt: number;
}

export interface NoteThreadProps {
  notes: ThreadNote[];
  onAdd: (note: string) => void;
  onDelete?: (id: string) => void;
  adding?: boolean;
  placeholder?: string;
  emptyText?: string;
  className?: string;
}

const MAX_NOTE_LENGTH = 2000;

/**
 * Composer + reverse-chronological note list, shared by reading annotations
 * (customer) and care notes (doctor). Presentational: the parent owns
 * fetching and persistence.
 */
export function NoteThread({
  notes,
  onAdd,
  onDelete,
  adding = false,
  placeholder = 'Add a note…',
  emptyText = 'No notes yet.',
  className,
}: NoteThreadProps) {
  const [draft, setDraft] = useState('');
  const trimmed = draft.trim();
  const canSubmit = trimmed.length > 0 && trimmed.length <= MAX_NOTE_LENGTH && !adding;

  const ordered = useMemo(() => [...notes].sort((a, b) => b.createdAt - a.createdAt), [notes]);

  return (
    <div className={cn('space-y-4', className)}>
      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSubmit) return;
          onAdd(trimmed);
          setDraft('');
        }}
      >
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={placeholder}
          rows={3}
          maxLength={MAX_NOTE_LENGTH}
          aria-label="Note"
          className={cn(
            'w-full rounded-md border border-sand-500 bg-surface-1 px-3 py-2 text-body text-ink-primary',
            'transition-colors duration-fast ease-standard placeholder:text-ink-muted',
            'focus-visible:outline-none focus-visible:border-primary-600 focus-visible:shadow-focus',
            'dark:border-sand-600 dark:focus-visible:border-primary-300',
          )}
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-caption text-ink-muted">
            {trimmed.length > 0 ? `${trimmed.length} / ${MAX_NOTE_LENGTH}` : ''}
          </span>
          <Button type="submit" size="sm" disabled={!canSubmit} loading={adding}>
            Add note
          </Button>
        </div>
      </form>

      {ordered.length === 0 ? (
        <p className="py-4 text-center text-body text-ink-muted">{emptyText}</p>
      ) : (
        <ul className="space-y-3">
          {ordered.map((note) => (
            <li
              key={note.id}
              className="rounded-md border border-border-hairline p-3 dark:border-border-hairline/[0.08]"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="text-caption text-ink-muted">
                  {note.author && <span className="font-semibold text-ink-secondary">{note.author}</span>}
                  {note.author && ' · '}
                  <time
                    dateTime={new Date(note.createdAt).toISOString()}
                    title={new Date(note.createdAt).toLocaleString()}
                  >
                    {relativeTime(note.createdAt)}
                  </time>
                </div>
                {onDelete && (
                  <Button
                    type="button"
                    size="sm"
                    variant="tertiary"
                    onClick={() => onDelete(note.id)}
                    aria-label="Delete note"
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                )}
              </div>
              {/* whitespace-pre-wrap keeps the author's line breaks; React
                  already escapes the text itself. */}
              <p className="mt-1 whitespace-pre-wrap text-body text-ink-primary">{note.note}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
