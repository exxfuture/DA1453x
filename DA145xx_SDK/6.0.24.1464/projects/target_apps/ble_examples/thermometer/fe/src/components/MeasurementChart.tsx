import { useMemo } from 'react';
import { MeasurementResponse, TemperatureUnit } from '../api/client';
import { useChartColors } from '../theme/chartColors';
import { convertFromCelsius } from '../utils/temperature';
import { MergedRow, TemperatureChart, TemperatureSeries } from './TemperatureChart';

export interface MeasurementChartProps {
  data: MeasurementResponse[];
  unit?: TemperatureUnit;
  /** Series label — only surfaced in the tooltip for a single series. */
  label?: string;
  height?: number;
  /** Forwarded to TemperatureChart — see its `onPointClick`. */
  onPointClick?: (row: MergedRow) => void;
  /** Forwarded to TemperatureChart — see its `annotations`. */
  annotations?: Array<{ id: string; ts: number }>;
}

/**
 * Single-series adapter over TemperatureChart: turns the API's
 * MeasurementResponse shape into the chart's series shape. Multi-series
 * callers (device/patient overlays) should use TemperatureChart directly.
 *
 * Callers that can switch which device is charted must pass a React `key`
 * (e.g. the BD address) — see TemperatureChart's note on the zoom window.
 */
export function MeasurementChart({
  data,
  unit = 'CELSIUS',
  label = 'Temperature',
  height,
  onPointClick,
  annotations,
}: MeasurementChartProps) {
  const colors = useChartColors();

  const series = useMemo<TemperatureSeries[]>(() => {
    // Backend returns newest-first; the chart reads left-to-right as
    // oldest-first. celsius is kept alongside the display-unit value so tier
    // classification always uses the clinical Celsius thresholds.
    const points = [...data]
      .reverse()
      .filter((m) => m.valueNum !== null)
      .map((m) => {
        const celsius = m.valueNum as number;
        return { ts: new Date(m.ts).getTime(), celsius, value: convertFromCelsius(celsius, unit) };
      });
    // A lone series takes the brand line color and needs no legend — the card
    // heading already names it.
    return [{ id: 'measurements', label, color: colors.line, points }];
  }, [data, unit, label, colors.line]);

  return (
    <TemperatureChart series={series} unit={unit} height={height} onPointClick={onPointClick} annotations={annotations} />
  );
}
