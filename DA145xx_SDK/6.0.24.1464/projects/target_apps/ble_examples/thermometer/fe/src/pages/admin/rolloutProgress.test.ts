import { describe, expect, it } from 'vitest';
import type { RolloutSummaryResponse } from '../../api/client';
import { progressVariant, rolloutProgress } from './rolloutProgress';

function rollout(overrides: Partial<RolloutSummaryResponse> = {}): RolloutSummaryResponse {
  return {
    id: 'r1',
    version: '1.2.3',
    chipModel: 'DA14531',
    imageUrl: 'https://example.test/fw.img',
    deltaUrl: null,
    groupPercentage: 100,
    abortThresholdPct: 10,
    status: 'active',
    createdAt: '2026-03-01T00:00:00Z',
    targetCount: 10,
    statusCounts: {},
    ...overrides,
  };
}

describe('rolloutProgress', () => {
  it('treats a rollout nobody has reported on as all-zero, not undefined', () => {
    expect(rolloutProgress(rollout())).toEqual({
      installed: 0,
      failed: 0,
      pending: 0,
      reported: 0,
      failedPct: 0,
    });
  });

  it('reads the statuses that are present', () => {
    const progress = rolloutProgress(rollout({ statusCounts: { installed: 6, failed: 1 } }));

    expect(progress.installed).toBe(6);
    expect(progress.failed).toBe(1);
    expect(progress.pending).toBe(0);
    expect(progress.reported).toBe(7);
    expect(progress.failedPct).toBe(10);
  });

  it('does not divide by zero when a rollout has no targets', () => {
    expect(rolloutProgress(rollout({ targetCount: 0 })).failedPct).toBe(0);
  });
});

describe('progressVariant', () => {
  it('flags a rollout past its own abort threshold', () => {
    expect(progressVariant(rollout({ abortThresholdPct: 10, statusCounts: { failed: 2 } }))).toBe('danger');
  });

  it('stays neutral at the threshold itself', () => {
    expect(progressVariant(rollout({ abortThresholdPct: 10, statusCounts: { failed: 1 } }))).toBe('default');
  });

  it('reports success only when every target installed', () => {
    expect(progressVariant(rollout({ statusCounts: { installed: 10 } }))).toBe('success');
    expect(progressVariant(rollout({ statusCounts: { installed: 9, pending: 1 } }))).toBe('default');
  });

  it('never calls an empty rollout complete', () => {
    expect(progressVariant(rollout({ targetCount: 0 }))).toBe('default');
  });
});
