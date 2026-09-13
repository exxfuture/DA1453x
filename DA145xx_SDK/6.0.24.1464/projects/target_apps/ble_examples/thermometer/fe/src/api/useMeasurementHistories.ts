import { useQueries } from '@tanstack/react-query';
import { api, MeasurementResponse } from './client';
import { resolveTimeWindow, timeWindowKey, type TimeWindow } from '../utils/timeWindow';

/**
 * The same rolling refetch cadence as `useMeasurementHistory` — the overlay
 * has to move in step with the single-device chart it replaces.
 */
const REFETCH_INTERVAL = 5000;

export interface MeasurementHistories {
  /** Keyed by BD address; only devices whose fetch has resolved appear. */
  byBdAddr: Record<string, MeasurementResponse[]>;
  isLoading: boolean;
  isError: boolean;
}

/**
 * Parallel history fetch for the multi-device overlay (customer feature #3).
 *
 * Deliberately mirrors `useMeasurementHistory`'s query key and fetch shape
 * rather than wrapping it: the key is identical, so a device already on screen
 * in single-device mode is served from the same cache entry when the user
 * switches to compare mode (and vice versa) instead of triggering a second
 * request for data the client already has.
 *
 * Like that hook, the window (see ../utils/timeWindow.ts) drives the key
 * while the from/to instants are resolved fresh at fetch time, so a sliding
 * window keeps moving with the clock and a custom one stays exactly what the
 * user picked.
 */
export function useMeasurementHistories(bdAddrs: string[], window: TimeWindow): MeasurementHistories {
  const results = useQueries({
    queries: bdAddrs.map((bdAddr) => ({
      queryKey: ['measurements', bdAddr, timeWindowKey(window)],
      queryFn: () => api.measurementHistory(bdAddr, 'temperature', resolveTimeWindow(window)),
      refetchInterval: REFETCH_INTERVAL,
    })),
  });

  const byBdAddr: Record<string, MeasurementResponse[]> = {};
  results.forEach((result, index) => {
    if (result.data) byBdAddr[bdAddrs[index]] = result.data;
  });

  return {
    byBdAddr,
    // "Loading" only while nothing is on screen yet — a background refetch of
    // one device must not blank the whole overlay.
    isLoading: results.some((result) => result.isLoading),
    isError: results.some((result) => result.isError),
  };
}
