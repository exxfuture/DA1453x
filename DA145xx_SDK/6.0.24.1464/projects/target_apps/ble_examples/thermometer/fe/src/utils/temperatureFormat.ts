import { TemperatureUnit } from '../api/client';
import { convertFromCelsius, unitSuffix } from './temperature';

/**
 * Display formatting for temperatures, shared by the doctor views (fleet
 * table, event feed, printable report) so "—" for missing data and the
 * decimal precision stay identical everywhere.
 */
export function formatTemperature(celsius: number | null | undefined, unit: TemperatureUnit, digits = 1): string {
  if (celsius == null) return '—';
  return `${convertFromCelsius(celsius, unit).toFixed(digits)}${unitSuffix(unit)}`;
}

/**
 * Formats a temperature *difference* (standard deviation, spread, delta).
 *
 * A delta is scaled, never offset: 1 °C of spread is 1.8 °F of spread, so
 * running it through convertFromCelsius (which adds 32) would be wrong.
 */
export function formatTemperatureDelta(celsius: number | null | undefined, unit: TemperatureUnit, digits = 2): string {
  if (celsius == null) return '—';
  const scaled = unit === 'FAHRENHEIT' ? (celsius * 9) / 5 : celsius;
  return `${scaled.toFixed(digits)}${unitSuffix(unit)}`;
}
