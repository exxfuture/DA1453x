import { useEffect, useState } from 'react';
import { resolvedIsDark, useThemeStore } from '../state/themeStore';
import type { TemperatureTier } from './temperature';

/**
 * Recharts takes raw color strings, not Tailwind classes, so these mirror
 * the light/dark CSS-variable values in src/index.css by hand rather than
 * pulling in a full recharts theme provider — see design spec §6 "Recharts
 * theming glue".
 */
export interface ChartColors {
  line: string;
  grid: string;
  axis: string;
  tooltipBg: string;
  tooltipBorder: string;
  /** Shaded temperature-tier bands (see components/TemperatureChart.tsx). */
  tierFill: Record<TemperatureTier, string>;
  /** Reading-note markers on the chart — ember-500, identical in both themes
   *  like the rest of the primitive ramps (see tailwind.config.js). */
  noteMarker: string;
  /**
   * Categorical series colors for multi-series overlays, assigned in this
   * fixed order and never cycled — a 7th series folds into "other" or gets
   * its own chart instead. Validated (OKLCH lightness band, chroma floor,
   * protan/deutan ΔE, normal-vision ΔE, surface contrast) against the
   * light (#FFFFFF) and dark (#1B1E1B) surface-1 tokens.
   *
   * Slot 1 leads with the aqua closest to brand Pine: the Pine ramp itself
   * can't serve as a categorical slot (every step sits below the OKLCH
   * chroma floor of 0.10, i.e. it reads as gray next to other hues), so it
   * stays the single-series/brand color while overlays use these.
   *
   * Light slots 1/5/6 fall below 3:1 against white; overlays therefore
   * always render the legend with visible text labels (identity is never
   * carried by color alone).
   */
  seriesPalette: string[];
}

/** Exported for the print/report chart, which is always drawn on paper white
 *  regardless of the app theme (see pages/doctor/PatientReportPage.tsx). */
export const LIGHT_CHART_COLORS: ChartColors = {
  line: '#1F7A6A', // primary-600
  grid: '#DEDACD', // sand-200
  axis: '#8A8069', // sand-500
  tooltipBg: '#FFFFFF', // surface-1
  tooltipBorder: '#DEDACD', // border-hairline
  // mirrors index.css lines 46-60 (--color-temp-*-tint, light)
  tierFill: {
    low: '#E4F0FC',
    normal: '#E7F5F1',
    elevated: '#FFF1DE',
    fever: '#FDE7DD',
    highFever: '#FBDBD8',
  },
  seriesPalette: ['#1BAF7A', '#2A78D6', '#EB6834', '#4A3AA7', '#E87BA4', '#EDA100'],
  noteMarker: '#ED6F1F', // ember-500
};

const DARK_CHART_COLORS: ChartColors = {
  line: '#7FCBB4', // primary-300
  grid: 'rgba(255, 255, 255, 0.08)',
  axis: '#A79E88', // sand-400
  tooltipBg: '#1B1E1B', // surface-1 (dark)
  tooltipBorder: 'rgba(255, 255, 255, 0.08)',
  // mirrors index.css lines 94-108 (--color-temp-*-tint, dark)
  tierFill: {
    low: '#14283D',
    normal: '#12302A',
    elevated: '#3A2A11',
    fever: '#3B2013',
    highFever: '#3A1614',
  },
  // Same six hues re-stepped for the dark surface — not an inverted copy.
  seriesPalette: ['#199E70', '#3987E5', '#D95926', '#9085E9', '#D55181', '#C98500'],
  noteMarker: '#ED6F1F', // ember-500
};

/**
 * How many series may be overlaid on one chart, derived from the palette rather
 * than restated as a literal.
 *
 * The cap is the palette: `seriesPalette` has six fixed validated slots and is
 * never cycled, so a seventh series would have to repeat a colour. One below
 * that keeps a legend readable, which is the practical limit anyway. Both
 * overlay call sites — the customer's multi-device compare and the doctor's
 * multi-patient compare — used to declare their own `5` under two different
 * names (review FE-30).
 */
export const MAX_OVERLAY_SERIES = LIGHT_CHART_COLORS.seriesPalette.length - 1;

export function useChartColors(): ChartColors {
  const theme = useThemeStore((s) => s.theme);
  const [isDark, setIsDark] = useState(() => resolvedIsDark(theme));

  useEffect(() => {
    setIsDark(resolvedIsDark(theme));
    if (theme !== 'system') return undefined;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = () => setIsDark(resolvedIsDark(theme));
    mediaQuery.addEventListener('change', listener);
    return () => mediaQuery.removeEventListener('change', listener);
  }, [theme]);

  return isDark ? DARK_CHART_COLORS : LIGHT_CHART_COLORS;
}
