import { useEffect, useMemo, useState } from 'react';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { cn } from './ui/cn';

export type ThresholdScope = 'system' | 'customer' | 'doctor-override';

export interface ThresholdValues {
  /** Temperature (°C) at/above which a reading is tagged Normal (and no longer Low). */
  normalStartC: number;
  /** Temperature (°C) at/above which a reading is tagged Elevated. */
  elevatedStartC: number;
  /** Temperature (°C) at/above which a reading is tagged Fever. */
  feverStartC: number;
  /** Temperature (°C) at/above which a reading is tagged High Fever. */
  highFeverStartC: number;
}

export interface ThresholdEditorProps {
  scope: ThresholdScope;
  value: ThresholdValues;
  /** Scope the effective values currently come from, when it isn't `scope`. */
  resolvedSource?: string;
  onSave: (value: ThresholdValues) => void;
  saving?: boolean;
  className?: string;
}

const SCOPE_LABEL: Record<ThresholdScope, string> = {
  system: 'System defaults',
  customer: 'My thresholds',
  'doctor-override': 'Doctor override',
};

const FIELDS: Array<{ key: keyof ThresholdValues; label: string; helper: string }> = [
  { key: 'normalStartC', label: 'Normal starts at', helper: 'Readings at or above this are no longer Low' },
  { key: 'elevatedStartC', label: 'Elevated starts at', helper: 'Readings at or above this are tagged Elevated' },
  { key: 'feverStartC', label: 'Fever starts at', helper: 'Readings at or above this are tagged Fever' },
  { key: 'highFeverStartC', label: 'High Fever starts at', helper: 'Readings at or above this are tagged High Fever' },
];

/** Plausible human-body range in °C — a typo like 380 shouldn't be savable. */
const MIN_CELSIUS = 25;
const MAX_CELSIUS = 45;

type Draft = Record<keyof ThresholdValues, string>;

function toDraft(value: ThresholdValues): Draft {
  return {
    normalStartC: String(value.normalStartC),
    elevatedStartC: String(value.elevatedStartC),
    feverStartC: String(value.feverStartC),
    highFeverStartC: String(value.highFeverStartC),
  };
}

/**
 * Presentational threshold form — the parent owns loading/persisting; this
 * component only validates and reports. Kept scope-aware (system / customer /
 * doctor-override) so the same form serves all three editors.
 */
export function ThresholdEditor({
  scope,
  value,
  resolvedSource,
  onSave,
  saving = false,
  className,
}: ThresholdEditorProps) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(value));

  // Re-seed when the parent loads/refreshes the stored values. Destructured
  // first so the dependency list can be the four numbers themselves: several
  // callers build `value` as a fresh object literal on every render (it is
  // derived from whichever scope is in effect), so depending on the object
  // would re-seed the form mid-edit and discard what the user typed.
  const { normalStartC, elevatedStartC, feverStartC, highFeverStartC } = value;
  useEffect(() => {
    setDraft(toDraft({ normalStartC, elevatedStartC, feverStartC, highFeverStartC }));
  }, [normalStartC, elevatedStartC, feverStartC, highFeverStartC]);

  const { parsed, errors } = useMemo(() => {
    const numbers = {} as Record<keyof ThresholdValues, number>;
    const fieldErrors = {} as Partial<Record<keyof ThresholdValues, string>>;

    for (const { key } of FIELDS) {
      const raw = draft[key].trim();
      const parsedValue = raw === '' ? NaN : Number(raw);
      numbers[key] = parsedValue;
      if (!Number.isFinite(parsedValue)) {
        fieldErrors[key] = 'Enter a number';
      } else if (parsedValue < MIN_CELSIUS || parsedValue > MAX_CELSIUS) {
        fieldErrors[key] = `Must be between ${MIN_CELSIUS} and ${MAX_CELSIUS} °C`;
      }
    }

    // Monotonic check, reported on the field that breaks the order.
    const order: Array<keyof ThresholdValues> = ['normalStartC', 'elevatedStartC', 'feverStartC', 'highFeverStartC'];
    for (let i = 1; i < order.length; i += 1) {
      const previous = order[i - 1];
      const current = order[i];
      if (fieldErrors[previous] || fieldErrors[current]) continue;
      if (numbers[current] <= numbers[previous]) {
        fieldErrors[current] = 'Must be higher than the tier that starts before it';
      }
    }

    return { parsed: numbers, errors: fieldErrors };
  }, [draft]);

  const isValid = Object.keys(errors).length === 0;
  const isDirty = FIELDS.some(({ key }) => parsed[key] !== value[key]);
  const inherits = resolvedSource != null && resolvedSource !== scope;

  return (
    <form
      className={cn('space-y-4', className)}
      onSubmit={(event) => {
        event.preventDefault();
        if (isValid && isDirty && !saving) onSave(parsed);
      }}
    >
      <div>
        <h3 className="text-h3 font-semibold text-ink-primary">{SCOPE_LABEL[scope]}</h3>
        {inherits && (
          <p className="mt-0.5 text-caption text-ink-muted">
            Currently inherits from <span className="font-semibold">{resolvedSource}</span> — saving here overrides it.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {FIELDS.map(({ key, label, helper }) => (
          <Input
            key={key}
            label={`${label} (°C)`}
            type="number"
            inputMode="decimal"
            step="0.1"
            min={MIN_CELSIUS}
            max={MAX_CELSIUS}
            value={draft[key]}
            onChange={(event) => setDraft((previous) => ({ ...previous, [key]: event.target.value }))}
            helperText={helper}
            errorText={errors[key]}
          />
        ))}
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="tertiary" onClick={() => setDraft(toDraft(value))} disabled={!isDirty || saving}>
          Reset
        </Button>
        <Button type="submit" size="sm" disabled={!isValid || !isDirty} loading={saving}>
          Save thresholds
        </Button>
      </div>
    </form>
  );
}
