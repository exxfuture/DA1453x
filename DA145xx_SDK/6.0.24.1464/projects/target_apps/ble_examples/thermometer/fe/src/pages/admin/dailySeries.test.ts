import { describe, expect, it } from 'vitest';
import { fillDailySeries } from './dailySeries';

const NOW = Date.parse('2026-03-10T14:32:00Z');
const DAY_MS = 86_400_000;
const TODAY = Date.parse('2026-03-10T00:00:00Z');

describe('fillDailySeries', () => {
  it('returns one point per day, ending today', () => {
    const series = fillDailySeries([], 5, NOW);

    expect(series).toHaveLength(5);
    expect(series[0].x).toBe(TODAY - 4 * DAY_MS);
    expect(series[4].x).toBe(TODAY);
  });

  it('fills days with no rows with zero rather than skipping them', () => {
    const series = fillDailySeries(
      [
        { day: '2026-03-08T00:00:00Z', count: 3 },
        { day: '2026-03-10T00:00:00Z', count: 1 },
      ],
      3,
      NOW,
    );

    expect(series.map((p) => p.y)).toEqual([3, 0, 1]);
  });

  it('sums entries that land on the same UTC day', () => {
    const series = fillDailySeries(
      [
        { day: '2026-03-10T00:00:00Z', count: 2 },
        { day: '2026-03-10T22:00:00Z', count: 5 },
      ],
      1,
      NOW,
    );

    expect(series).toEqual([{ x: TODAY, y: 7 }]);
  });

  it('ignores days outside the window instead of folding them into the first bucket', () => {
    const series = fillDailySeries(
      [
        { day: '2026-01-01T00:00:00Z', count: 99 },
        { day: '2026-03-10T00:00:00Z', count: 1 },
      ],
      2,
      NOW,
    );

    expect(series.map((p) => p.y)).toEqual([0, 1]);
  });

  it('ignores unparseable days', () => {
    const series = fillDailySeries([{ day: 'not-a-date', count: 4 }], 1, NOW);

    expect(series).toEqual([{ x: TODAY, y: 0 }]);
  });
});
