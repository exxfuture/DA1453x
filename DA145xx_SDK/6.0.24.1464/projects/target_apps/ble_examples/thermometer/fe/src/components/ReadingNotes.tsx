import { useMemo } from 'react';
import { NotebookPen } from 'lucide-react';
import { TemperatureUnit } from '../api/client';
import { useAnnotations, useCreateAnnotation, useDeleteAnnotation } from '../api/queries';
import { convertFromCelsius, unitSuffix } from '../utils/temperature';
import type { TimeWindow } from '../utils/timeWindow';
import { NoteThread, type ThreadNote } from './NoteThread';
import { Alert } from './ui/Alert';
import { Button } from './ui/Button';
import { Card } from './ui/Card';
import { SkeletonBlock } from './ui/EmptyState';

export interface SelectedReading {
  /** Epoch ms of the clicked point. */
  ts: number;
  /** Raw Celsius at that point, when the clicked series had a value there. */
  celsius: number | null;
}

export interface ReadingNotesProps {
  deviceBdAddr: string;
  /** Same window as the chart — notes are listed for the visible range. */
  window: TimeWindow;
  unit: TemperatureUnit;
  /** The point the user clicked on the chart, if any. */
  selected: SelectedReading | null;
  onClearSelection: () => void;
  /** Timestamp new notes attach to when no point is selected (the latest reading). */
  fallbackTs: number | null;
  className?: string;
}

function formatAnchor(ts: number): string {
  return new Date(ts).toLocaleString();
}

/**
 * Customer reading annotations (feature #6).
 *
 * Notes are anchored to an instant on the device's timeline: clicking a point
 * on the chart selects that instant, and without a selection a new note
 * attaches to the most recent reading. The list shows every note inside the
 * chart's current range, so notes stay discoverable without hunting for the
 * point they were written on.
 */
export function ReadingNotes({
  deviceBdAddr,
  window,
  unit,
  selected,
  onClearSelection,
  fallbackTs,
  className,
}: ReadingNotesProps) {
  const annotationsQuery = useAnnotations(deviceBdAddr, window);
  const createAnnotation = useCreateAnnotation();
  const deleteAnnotation = useDeleteAnnotation();

  const anchorTs = selected?.ts ?? fallbackTs ?? Date.now();

  const notes = useMemo<ThreadNote[]>(
    () =>
      (annotationsQuery.data ?? []).map((annotation) => ({
        id: annotation.id,
        // The thread's own timestamp is when the note was written; the reading
        // it describes is the more useful identifier, so it leads the line.
        author: `Reading at ${formatAnchor(new Date(annotation.tsFrom).getTime())}`,
        note: annotation.note,
        createdAt: new Date(annotation.createdAt).getTime(),
      })),
    [annotationsQuery.data],
  );

  const handleAdd = (note: string) => {
    createAnnotation.mutate(
      { deviceBdAddr, tsFrom: new Date(anchorTs).toISOString(), note },
      { onSuccess: onClearSelection },
    );
  };

  return (
    <Card
      density="compact"
      className={className}
      header={
        <h2 className="flex items-center gap-2 text-h3 font-semibold text-ink-primary">
          <NotebookPen className="size-4" aria-hidden />
          Notes
        </h2>
      }
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-caption text-ink-muted">
          {selected ? (
            <>
              New note attaches to{' '}
              <span className="font-semibold text-ink-secondary">{formatAnchor(selected.ts)}</span>
              {selected.celsius != null && (
                <span className="font-tabular">
                  {' '}
                  · {convertFromCelsius(selected.celsius, unit).toFixed(2)} {unitSuffix(unit)}
                </span>
              )}
            </>
          ) : (
            'Tap a point on the chart to attach a note to that reading — otherwise notes attach to your latest one.'
          )}
        </p>
        {selected && (
          <Button size="sm" variant="tertiary" onClick={onClearSelection}>
            Clear selection
          </Button>
        )}
      </div>

      {annotationsQuery.isLoading ? (
        <SkeletonBlock className="h-24" />
      ) : (
        <NoteThread
          notes={notes}
          onAdd={handleAdd}
          onDelete={(id) => deleteAnnotation.mutate(id)}
          adding={createAnnotation.isPending}
          placeholder="e.g. took paracetamol, felt shivery…"
          emptyText="No notes on these readings yet."
        />
      )}

      {createAnnotation.isError && (
        <Alert status="danger" className="mt-3">
          Could not save that note — please try again.
        </Alert>
      )}
      {deleteAnnotation.isError && (
        <Alert status="danger" className="mt-3">
          Could not delete that note — please try again.
        </Alert>
      )}
    </Card>
  );
}
