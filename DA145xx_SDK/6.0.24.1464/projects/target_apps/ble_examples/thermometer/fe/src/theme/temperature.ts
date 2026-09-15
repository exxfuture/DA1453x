import { AlertTriangle, Flame } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * The 5-tier temperature-status scale from the design system ("Pine &
 * Ember" spec §1.4). Thresholds are oral-equivalent °C placeholders for
 * engineering, NOT medical advice — confirm exact cut points and
 * measurement-site adjustment (axillary/oral/tympanic) with a clinical
 * advisor before relying on this for real triage.
 */
export type TemperatureTier = 'low' | 'normal' | 'elevated' | 'fever' | 'highFever';

export interface TemperatureTierInfo {
  tier: TemperatureTier;
  label: string;
  /** Non-color cue: never rely on color alone to convey status. */
  icon: 'snowflake' | 'check-circle' | 'alert-triangle' | 'flame' | 'flame-alert';
}

/**
 * The single source of truth for the tier cut points. Everything that needs a
 * boundary (classification, chart bands, backend fallbacks) derives from this
 * array — never re-declare a threshold anywhere else.
 */
const TIERS: Array<{ max: number; info: TemperatureTierInfo }> = [
  { max: 36.0, info: { tier: 'low', label: 'Low', icon: 'snowflake' } },
  { max: 37.5, info: { tier: 'normal', label: 'Normal', icon: 'check-circle' } },
  { max: 38.1, info: { tier: 'elevated', label: 'Elevated', icon: 'alert-triangle' } },
  { max: 39.5, info: { tier: 'fever', label: 'Fever', icon: 'flame' } },
  { max: Infinity, info: { tier: 'highFever', label: 'High Fever', icon: 'flame-alert' } },
];

export function getTemperatureTier(celsius: number): TemperatureTierInfo {
  return (TIERS.find((t) => celsius < t.max) ?? TIERS[TIERS.length - 1]).info;
}

export interface TemperatureTierBand extends TemperatureTierInfo {
  /** Inclusive lower bound in °C; -Infinity for the open-ended bottom tier. */
  min: number;
  /** Exclusive upper bound in °C; Infinity for the open-ended top tier. */
  max: number;
}

/**
 * The same tiers expressed as [min, max) °C ranges, for charts that shade the
 * scale (see components/TemperatureChart.tsx). Derived from TIERS above so the
 * cut points exist exactly once. The open ends are ±Infinity on purpose:
 * consumers are expected to clamp them to whatever axis range they're drawing
 * into, and Math.min/Math.max do that for free.
 */
export const TEMPERATURE_TIER_BANDS: TemperatureTierBand[] = TIERS.map((t, i) => ({
  ...t.info,
  min: i === 0 ? -Infinity : TIERS[i - 1].max,
  max: t.max,
}));

/** Tier label by tier, for the feeds that render a tier name without a band. */
export const TIER_LABEL: Record<TemperatureTier, string> = Object.fromEntries(
  TEMPERATURE_TIER_BANDS.map((band) => [band.tier, band.label]),
) as Record<TemperatureTier, string>;

/**
 * The concrete lucide icon per tier, for list/timeline rows.
 *
 * Declared here, next to the bands, rather than in each feed page: HistoryPage
 * and EventsPage carried byte-for-byte identical copies of this map, comment
 * included (review FE-27), so an iconography change had two places to miss.
 *
 * `TemperatureTierInfo.icon` above stays the abstract name — it is what the
 * design-system doc and the badge components key off, and keeping the concrete
 * `LucideIcon` separate is what lets `theme/` stay free of a hard dependency on
 * one icon set for anything but this convenience map.
 *
 * Only the three raised tiers can appear in a fever episode; `low` and `normal`
 * are mapped because the tier union is shared, and are never rendered by the
 * episode feeds.
 */
export const TIER_ICON: Record<TemperatureTier, LucideIcon> = {
  low: AlertTriangle,
  normal: AlertTriangle,
  elevated: AlertTriangle,
  fever: Flame,
  highFever: Flame,
};
