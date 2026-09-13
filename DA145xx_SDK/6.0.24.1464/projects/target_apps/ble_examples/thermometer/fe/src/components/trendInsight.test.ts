import { describe, expect, it } from 'vitest';
import { computeTrendInsight, type InsightReading } from './trendInsight';

const HOUR = 3_600_000;
const NOW = new Date('2026-03-10T12:00:00').getTime();

function readingsAt(now: number, entries: Array<[hoursAgo: number, celsius: number]>): InsightReading[] {
  return entries.map(([hoursAgo, celsius]) => ({ ts: now - hoursAgo * HOUR, celsius }));
}

describe('computeTrendInsight', () => {
  it('returns an empty summary for no readings', () => {
    const insight = computeTrendInsight([], 24, NOW);
    expect(insight.readingCount).toBe(0);
    expect(insight.comparison).toBeNull();
    expect(insight.highest).toBeNull();
    expect(insight.lowest).toBeNull();
  });

  it('compares the recent half of the window against the prior half', () => {
    const insight = computeTrendInsight(
      readingsAt(NOW, [
        [23, 36.8],
        [22, 36.8],
        [2, 37.4],
        [1, 37.4],
      ]),
      24,
      NOW,
    );

    expect(insight.comparison).not.toBeNull();
    expect(insight.comparison?.recentAvgCelsius).toBeCloseTo(37.4, 5);
    expect(insight.comparison?.priorAvgCelsius).toBeCloseTo(36.8, 5);
    expect(insight.comparison?.deltaCelsius).toBeCloseTo(0.6, 5);
    expect(insight.comparison?.direction).toBe('up');
    expect(insight.comparison?.halfHours).toBe(12);
  });

  it('calls a sub-0.1 °C difference flat rather than a trend', () => {
    const insight = computeTrendInsight(
      readingsAt(NOW, [
        [23, 36.8],
        [22, 36.82],
        [2, 36.85],
        [1, 36.85],
      ]),
      24,
      NOW,
    );
    expect(insight.comparison?.direction).toBe('flat');
  });

  it('skips the comparison when a half is too sparse', () => {
    const insight = computeTrendInsight(readingsAt(NOW, [[23, 36.8], [1, 37.4], [2, 37.5]]), 24, NOW);
    expect(insight.comparison).toBeNull();
  });

  it('ignores readings older than the window when averaging', () => {
    const insight = computeTrendInsight(
      readingsAt(NOW, [
        [100, 40.0],
        [23, 36.8],
        [22, 36.8],
        [2, 36.9],
        [1, 36.9],
      ]),
      24,
      NOW,
    );
    // The 40 °C reading is outside the 24 h window: it must not pull the
    // prior-half average, even though it is still the highest reading fetched.
    expect(insight.comparison?.priorAvgCelsius).toBeCloseTo(36.8, 5);
    expect(insight.highest?.celsius).toBe(40.0);
  });

  it('reports the highest and lowest readings', () => {
    const insight = computeTrendInsight(
      readingsAt(NOW, [
        [5, 36.4],
        [3, 39.1],
        [1, 37.0],
      ]),
      24,
      NOW,
    );
    expect(insight.highest?.celsius).toBe(39.1);
    expect(insight.lowest?.celsius).toBe(36.4);
  });

  it('omits the day streak for windows shorter than two days', () => {
    expect(computeTrendInsight(readingsAt(NOW, [[1, 36.9]]), 24, NOW).normalDayStreak).toBeNull();
  });

  it('counts consecutive days whose every reading was normal', () => {
    // 12:00 "now": today, yesterday and the day before all read normal.
    const insight = computeTrendInsight(
      readingsAt(NOW, [
        [1, 36.9],
        [25, 37.0],
        [49, 36.7],
      ]),
      24 * 7,
      NOW,
    );
    expect(insight.normalDayStreak).toBe(3);
  });

  it('breaks the streak on a day that had a fever reading', () => {
    const insight = computeTrendInsight(
      readingsAt(NOW, [
        [1, 36.9],
        [25, 39.0],
        [49, 36.7],
      ]),
      24 * 7,
      NOW,
    );
    expect(insight.normalDayStreak).toBe(1);
  });

  it('breaks the streak on a calendar day with no readings at all', () => {
    // Yesterday is missing entirely — an unknown day is not a healthy day.
    const insight = computeTrendInsight(
      readingsAt(NOW, [
        [1, 36.9],
        [49, 36.7],
      ]),
      24 * 7,
      NOW,
    );
    expect(insight.normalDayStreak).toBe(1);
  });
});
