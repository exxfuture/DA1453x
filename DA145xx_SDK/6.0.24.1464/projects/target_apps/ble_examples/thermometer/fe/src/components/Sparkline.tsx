import { useChartColors } from '../theme/chartColors';
import type { SparkPoint } from '../api/client';

/** Minimal inline-SVG trend line — deliberately not a recharts instance:
 *  the doctor dashboard renders one per patient row, and a full chart
 *  (axes, tooltip, responsive container) per row would be needless
 *  overhead for a glance-only trend indicator. */
export function Sparkline({
  points,
  width = 96,
  height = 28,
}: {
  points: SparkPoint[];
  width?: number;
  height?: number;
}) {
  const colors = useChartColors();

  if (points.length < 2) {
    return <span className="text-caption text-ink-muted">Not enough data</span>;
  }

  const values = points.map((p) => p.celsius);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = width / (points.length - 1);
  const pad = 2;

  const coords = points
    .map((p, i) => {
      const x = i * stepX;
      const y = pad + (1 - (p.celsius - min) / range) * (height - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible" aria-hidden>
      <polyline points={coords} fill="none" stroke={colors.line} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
