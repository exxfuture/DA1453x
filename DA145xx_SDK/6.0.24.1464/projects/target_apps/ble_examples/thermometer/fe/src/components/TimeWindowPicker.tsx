import { useState } from 'react';
import type { TimeWindow } from '../utils/timeWindow';
import { Button } from './ui/Button';
import { Input } from './ui/Input';

export interface TimeWindowPickerProps {
  /** Preset buttons, shown before "Custom". */
  presets: Array<{ label: string; hours: number }>;
  value: TimeWindow;
  onChange: (window: TimeWindow) => void;
  className?: string;
}

/** `datetime-local` inputs want local "YYYY-MM-DDTHH:mm", no timezone. */
function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Preset "1h/24h/7d"-style buttons plus a "Custom" toggle that reveals two
 * `datetime-local` inputs. Shared by DashboardPage and HistoryPage so their
 * range controls (and the custom-range validation) stay identical.
 *
 * The custom inputs hold their own draft state and only commit on "Apply" —
 * committing on every keystroke would refetch mid-typing and fight the user.
 */
export function TimeWindowPicker({ presets, value, onChange, className }: TimeWindowPickerProps) {
  const [showCustom, setShowCustom] = useState(value.kind === 'custom');
  const [draftFrom, setDraftFrom] = useState(() => (value.kind === 'custom' ? toLocalInputValue(value.from) : ''));
  const [draftTo, setDraftTo] = useState(() => (value.kind === 'custom' ? toLocalInputValue(value.to) : ''));

  const parsedFrom = draftFrom ? new Date(draftFrom) : null;
  const parsedTo = draftTo ? new Date(draftTo) : null;
  const rangeInvalid = !!parsedFrom && !!parsedTo && parsedFrom >= parsedTo;

  const applyCustom = () => {
    if (!parsedFrom || !parsedTo || rangeInvalid) return;
    onChange({ kind: 'custom', from: parsedFrom.toISOString(), to: parsedTo.toISOString() });
  };

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-1">
        {presets.map((preset) => (
          <Button
            key={preset.label}
            size="sm"
            variant={!showCustom && value.kind === 'sliding' && value.hours === preset.hours ? 'primary' : 'tertiary'}
            onClick={() => {
              setShowCustom(false);
              onChange({ kind: 'sliding', hours: preset.hours });
            }}
          >
            {preset.label}
          </Button>
        ))}
        <Button size="sm" variant={showCustom ? 'primary' : 'tertiary'} onClick={() => setShowCustom((s) => !s)}>
          Custom
        </Button>
      </div>

      {showCustom && (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <Input
            label="From"
            type="datetime-local"
            value={draftFrom}
            onChange={(event) => setDraftFrom(event.target.value)}
          />
          <Input label="To" type="datetime-local" value={draftTo} onChange={(event) => setDraftTo(event.target.value)} />
          <Button size="sm" onClick={applyCustom} disabled={!draftFrom || !draftTo || rangeInvalid}>
            Apply
          </Button>
          {rangeInvalid && <p className="w-full text-caption text-danger-text">"From" must be before "To".</p>}
        </div>
      )}
    </div>
  );
}
