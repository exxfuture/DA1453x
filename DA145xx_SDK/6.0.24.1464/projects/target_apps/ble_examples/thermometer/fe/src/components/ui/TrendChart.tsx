import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useChartColors } from '../../theme/chartColors';

export interface TrendPoint {
  x: string | number;
  y: number;
}

export interface TrendChartProps {
  data: TrendPoint[];
  /** Defaults to the brand line color. */
  color?: string;
  height?: number;
  /** Series name shown in the tooltip. */
  label?: string;
  /** Formats both the tick labels and the tooltip's x value. */
  xFormatter?: (x: string | number) => string;
}

/**
 * Small single-metric trend chart for the admin metric panels — deliberately
 * plain: no tier bands, no brush, no zoom. Reach for TemperatureChart when the
 * reading is a temperature and the clinical scale matters.
 */
export function TrendChart({ data, color, height = 140, label = 'Value', xFormatter }: TrendChartProps) {
  const colors = useChartColors();
  const stroke = color ?? colors.line;
  const gradientId = `trend-fill-${label.replace(/\W+/g, '-')}`;

  if (data.length === 0) {
    return <div className="py-8 text-center text-body text-ink-muted">No data yet.</div>;
  }

  return (
    <ResponsiveContainer width="100%" height={height} debounce={50}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity={0.25} />
            <stop offset="100%" stopColor={stroke} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} vertical={false} />
        <XAxis
          dataKey="x"
          tickFormatter={xFormatter}
          tick={{ fontSize: 12, fill: colors.axis }}
          tickLine={false}
          axisLine={{ stroke: colors.grid }}
          minTickGap={24}
        />
        <YAxis
          tick={{ fontSize: 12, fill: colors.axis }}
          width={48}
          tickLine={false}
          axisLine={{ stroke: colors.grid }}
          allowDecimals={false}
        />
        <Tooltip
          labelFormatter={(x) => (xFormatter ? xFormatter(x as string | number) : String(x))}
          formatter={(value: number) => [value, label] as [number, string]}
          contentStyle={{
            backgroundColor: colors.tooltipBg,
            border: `1px solid ${colors.tooltipBorder}`,
            borderRadius: 10,
            fontSize: 13,
          }}
        />
        <Area
          type="monotone"
          dataKey="y"
          name={label}
          stroke={stroke}
          strokeWidth={2}
          fill={`url(#${gradientId})`}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
