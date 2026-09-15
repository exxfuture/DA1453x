import { useCallback, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  Brush,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { TemperatureUnit } from '../api/client';
import { useChartColors } from '../theme/chartColors';
import { getTemperatureTier, TEMPERATURE_TIER_BANDS } from '../theme/temperature';
import { convertFromCelsius, unitSuffix } from '../utils/temperature';
import {
  computeYDomain,
  mergeSeries,
  nearestIndex,
  resolveWindow,
  shiftWindow,
  type MergedRow,
  type TemperatureSeries,
  type TemperatureSeriesPoint,
} from './temperatureWindow';
import { Button } from './ui/Button';

export type { MergedRow, TemperatureSeries, TemperatureSeriesPoint } from './temperatureWindow';

export interface TemperatureChartProps {
  series: TemperatureSeries[];
  unit: TemperatureUnit;
  /** Shade the 5 clinical tiers behind the plot. Default true. */
  showBands?: boolean;
  /** Plot height in px, excluding the brush strip below it. Default 280. */
  height?: number;
  /**
   * Called with the merged row nearest the pointer when the plot is clicked —
   * used by the dashboard to anchor a note to a reading. Optional: without it
   * the chart is inert, exactly as before.
   */
  onPointClick?: (row: MergedRow) => void;
  /**
   * Reading notes to mark on the chart at their anchor instant (`ts`), so a
   * note's location is visible without hunting through the side list.
   * Clicking a marker behaves exactly like clicking the chart at that point —
   * it goes through `onPointClick`, same as any other spot on the line.
   */
  annotations?: Array<{ id: string; ts: number }>;
}

/** Radius (px) of the note-marker pin, hit-tested a little larger via a
 *  transparent halo so it's tappable on touch without looking oversized. */
const NOTE_MARKER_RADIUS = 5;

function NoteMarker({
  cx,
  cy,
  color,
  onClick,
}: {
  cx?: number;
  cy?: number;
  color: string;
  onClick?: () => void;
}) {
  if (cx == null || cy == null) return null;
  return (
    <g
      onClick={(event) => {
        event.stopPropagation();
        onClick?.();
      }}
      style={onClick ? { cursor: 'pointer' } : undefined}
    >
      {/* Transparent halo widens the click/tap target without enlarging the visible dot. */}
      <circle cx={cx} cy={cy} r={NOTE_MARKER_RADIUS + 6} fill="transparent" />
      <circle cx={cx} cy={cy} r={NOTE_MARKER_RADIUS} fill={color} stroke="#FFFFFF" strokeWidth={1.5} />
    </g>
  );
}

/** Height the Brush strip adds below the plot area. */
const BRUSH_STRIP_HEIGHT = 48;
const BRUSH_HEIGHT = 40;

/** Tier tints are near-surface by design, so they need a high opacity to
 *  register at all; anything near 0.1 renders as an invisible band. */
const BAND_FILL_OPACITY = 0.85;

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function ChartTooltip({
  active,
  payload,
  series,
  unit,
}: {
  active?: boolean;
  payload?: Array<{ payload: MergedRow }>;
  series: TemperatureSeries[];
  unit: TemperatureUnit;
}) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;

  const entries = series
    .map((s) => ({ series: s, point: row.points[s.id] }))
    .filter((entry): entry is { series: TemperatureSeries; point: TemperatureSeriesPoint } => entry.point != null);
  if (entries.length === 0) return null;

  return (
    <div className="rounded-md border border-border-hairline bg-surface-1 p-3 shadow-sm dark:border-border-hairline/[0.08]">
      {entries.map(({ series: s, point }) => {
        const tierInfo = getTemperatureTier(point.celsius);
        return (
          <div key={s.id} className="flex items-center gap-2 text-body font-semibold text-ink-primary">
            <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: s.color }} aria-hidden />
            {series.length > 1 && <span className="text-ink-secondary">{s.label}</span>}
            <span className="font-tabular">
              {point.value.toFixed(2)} {unitSuffix(unit)}
            </span>
            <span className="text-ink-secondary">· {tierInfo.label}</span>
          </div>
        );
      })}
      <div className="mt-0.5 text-caption text-ink-muted">{new Date(row.ts).toLocaleString()}</div>
    </div>
  );
}

/**
 * Scrollable, auto-scaling temperature chart with the 5-tier clinical scale
 * shaded behind the plot. Drives one <Line> per series, so it serves both the
 * single-device history and multi-device / multi-patient overlays.
 *
 * The window is held as **timestamps**, never Brush indices, and re-resolved
 * against the current data every render — see resolveWindow() in
 * ./temperatureWindow.ts for why that matters with a rolling refetch.
 *
 * The zoom window is component state and is deliberately *not* reset from
 * props: a rolling refetch changes `series` every few seconds, and resetting on
 * that would fight the user. Callers that can swap the charted **subject**
 * (device picker, patient picker, overlay selection) must therefore pass a
 * React `key` derived from that subject's identity, so the switch remounts the
 * chart instead of carrying device A's absolute time window over onto B's data.
 *
 * Recharts note: <Brush> cannot own its own data here — the parent chart clones
 * it and overwrites data/startIndex/endIndex with the chart's own (recharts
 * 2.15.4, generateCategoricalChart `renderBrush`). Hence one merged wide-format
 * array as the chart's `data` with a `dataKey` accessor per series, rather than
 * a `data` prop per <Line>.
 */
export function TemperatureChart({
  series,
  unit,
  showBands = true,
  height = 280,
  onPointClick,
  annotations,
}: TemperatureChartProps) {
  const colors = useChartColors();

  const rows = useMemo(() => mergeSeries(series), [series]);

  // Resolve each note to the nearest plotted row, so the marker sits on the
  // line even though an annotation only stores an instant, not a value.
  const noteMarkers = useMemo(() => {
    if (!annotations || annotations.length === 0 || rows.length === 0) return [];
    return annotations
      .map((annotation) => {
        const row = rows[nearestIndex(rows, annotation.ts)];
        const point = Object.values(row.points).find((p) => p != null);
        if (!point) return null;
        return { id: annotation.id, row, value: point.value };
      })
      .filter((marker): marker is { id: string; row: MergedRow; value: number } => marker != null);
  }, [annotations, rows]);

  // null = "follow the data" (full current extent, keeps tracking new
  // readings). Set to a timestamp pair once the user brushes or steps.
  const [zoomWindow, setZoomWindow] = useState<[number, number] | null>(null);

  const resolved = useMemo(() => resolveWindow(rows, zoomWindow), [rows, zoomWindow]);
  const { startIndex, endIndex, start: windowStart, end: windowEnd, fullStart, fullEnd } = resolved;

  const handleBrushChange = useCallback(
    (range: { startIndex?: number; endIndex?: number }) => {
      if (range.startIndex == null || range.endIndex == null) return;
      const from = rows[range.startIndex];
      const to = rows[range.endIndex];
      if (!from || !to) return;
      setZoomWindow([from.ts, to.ts]);
    },
    [rows],
  );

  const step = useCallback(
    (direction: -1 | 1) => {
      const next = shiftWindow(resolved, direction);
      if (next) setZoomWindow(next);
    },
    [resolved],
  );

  // Chart-level click rather than a per-dot handler: dots are hidden (a
  // multi-hour window holds thousands of points), and recharts already
  // resolves the pointer to the nearest row for the tooltip — reusing that
  // gives a target the whole plot height wide, which is the only version that
  // is hittable on touch.
  //
  // Read the row out of activePayload, never via state.activeTooltipIndex:
  // that index is relative to the *brush-sliced* data (recharts 2.15.4,
  // generateCategoricalChart `getTooltipContent`), so indexing `rows` with it
  // would silently select the wrong reading as soon as the chart is zoomed.
  // activeLabel is the ts of the same row and backs it up.
  const handleChartClick = useCallback(
    (state: { activePayload?: Array<{ payload?: unknown }>; activeLabel?: string | number }) => {
      if (!onPointClick) return;

      const payload = state?.activePayload?.[0]?.payload as MergedRow | undefined;
      if (payload && typeof payload.ts === 'number') {
        onPointClick(payload);
        return;
      }

      const ts = Number(state?.activeLabel);
      if (!Number.isFinite(ts)) return;
      const row = rows[nearestIndex(rows, ts)];
      if (row) onPointClick(row);
    },
    [onPointClick, rows],
  );

  const yDomain = useMemo(
    () => computeYDomain(series, windowStart, windowEnd, unit),
    [series, windowStart, windowEnd, unit],
  );

  // Below two rows there is no window to draw: start === end, so the XAxis
  // domain is zero-width and recharts divides by that span. Reachable right
  // after a device's first-ever reading, or when a short range happens to hold
  // a single sample — same floor as ReportChart in pages/doctor/PatientReportPage.tsx.
  if (rows.length < 2) {
    return (
      <div className="py-12 text-center text-body text-ink-muted">
        {rows.length === 0 ? 'No readings in this range yet.' : 'Not enough readings to plot in this range.'}
      </div>
    );
  }

  const atStart = windowStart <= fullStart;
  const atEnd = windowEnd >= fullEnd;

  return (
    <div>
      {series.length > 1 && (
        // Identity is never color-alone: every series is legended with a
        // visible text label (also the readability relief for the lighter
        // palette slots on a white surface).
        <ul className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          {series.map((s) => (
            <li key={s.id} className="flex items-center gap-1.5 text-caption text-ink-secondary">
              <span className="size-2.5 rounded-full" style={{ backgroundColor: s.color }} aria-hidden />
              {s.label}
            </li>
          ))}
        </ul>
      )}

      {/* debounce softens the Brush-drag + resize re-layout storm. */}
      <ResponsiveContainer width="100%" height={height + BRUSH_STRIP_HEIGHT} debounce={50}>
        <LineChart
          data={rows}
          margin={{ top: 8, right: 16, bottom: 8, left: 8 }}
          onClick={onPointClick ? handleChartClick : undefined}
          style={onPointClick ? { cursor: 'pointer' } : undefined}
        >
          <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} vertical={false} />
          {showBands &&
            yDomain &&
            TEMPERATURE_TIER_BANDS.map((band) => {
              // Clamp to the computed domain so the bands compose with the
              // zoom instead of fighting it (the ±Infinity ends of the outer
              // tiers collapse onto the domain edge for free).
              const from = Math.max(convertFromCelsius(band.min, unit), yDomain[0]);
              const to = Math.min(convertFromCelsius(band.max, unit), yDomain[1]);
              if (!(to > from)) return null;
              return (
                <ReferenceArea
                  key={band.tier}
                  y1={from}
                  y2={to}
                  fill={colors.tierFill[band.tier]}
                  fillOpacity={BAND_FILL_OPACITY}
                  strokeWidth={0}
                  ifOverflow="hidden"
                />
              );
            })}
          <XAxis
            dataKey="ts"
            type="number"
            domain={[windowStart, windowEnd]}
            allowDataOverflow
            tickFormatter={formatTime}
            tick={{ fontSize: 12, fill: colors.axis }}
            tickLine={false}
            axisLine={{ stroke: colors.grid }}
          />
          <YAxis
            domain={yDomain ?? ['auto', 'auto']}
            allowDataOverflow
            tickFormatter={(value: number) => `${value.toFixed(2)}${unitSuffix(unit)}`}
            tick={{ fontSize: 12, fill: colors.axis }}
            width={72}
            tickLine={false}
            axisLine={{ stroke: colors.grid }}
          />
          <Tooltip content={<ChartTooltip series={series} unit={unit} />} />
          {series.map((s) => (
            <Line
              key={s.id}
              type="monotone"
              name={s.label}
              // Accessor form: rows are keyed by timestamp, and a series may
              // have no reading at another series' timestamp.
              dataKey={(row: MergedRow) => row.points[s.id]?.value ?? null}
              stroke={s.color}
              strokeWidth={2}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          ))}
          {noteMarkers.map((marker) => (
            <ReferenceDot
              key={marker.id}
              x={marker.row.ts}
              y={marker.value}
              ifOverflow="hidden"
              shape={(props: { cx?: number; cy?: number }) => (
                <NoteMarker
                  cx={props.cx}
                  cy={props.cy}
                  color={colors.noteMarker}
                  onClick={onPointClick ? () => onPointClick(marker.row) : undefined}
                />
              )}
            />
          ))}
          <Brush
            dataKey="ts"
            height={BRUSH_HEIGHT}
            travellerWidth={18}
            stroke={colors.grid}
            fill={colors.tooltipBg}
            tickFormatter={(ts) => formatTime(ts as number)}
            startIndex={startIndex}
            endIndex={endIndex}
            onChange={handleBrushChange}
          />
        </LineChart>
      </ResponsiveContainer>

      {/* Step buttons ship unconditionally: dragging a traveller precisely is
          awkward on touch and impossible by keyboard alone. */}
      <div className="mt-1 flex items-center justify-between gap-2">
        <Button size="sm" variant="tertiary" onClick={() => step(-1)} disabled={atStart} aria-label="Scroll back in time">
          <ChevronLeft className="size-4" aria-hidden />
          Earlier
        </Button>
        {zoomWindow && (
          <Button size="sm" variant="tertiary" onClick={() => setZoomWindow(null)}>
            Reset zoom
          </Button>
        )}
        <Button size="sm" variant="tertiary" onClick={() => step(1)} disabled={atEnd} aria-label="Scroll forward in time">
          Later
          <ChevronRight className="size-4" aria-hidden />
        </Button>
      </div>
    </div>
  );
}
