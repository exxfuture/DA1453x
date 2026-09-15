import { useEffect, useState } from 'react';
import type { DeviceResponse } from '../api/client';
import { useUiPreferences } from '../state/uiStore';
import { resolveSelectedBdAddr } from '../utils/devices';

export interface SelectedDevice {
  /** null while the device list is empty or still loading. */
  selectedBdAddr: string | null;
  setSelectedBdAddr: (bdAddr: string) => void;
}

/**
 * "Which of my devices am I looking at?" — the remembered-choice logic shared
 * by the Dashboard and the History page.
 *
 * Both pages carried the same pair of effects (review FE-20), which is exactly
 * the kind of stateful cross-cutting logic that diverges on the next edit. The
 * rules, in one place:
 *
 *  - the choice persists across navigation and visits (localStorage via
 *    zustand `persist`), so a customer with several devices who checks History
 *    or Settings and comes back is still looking at *their* device rather than
 *    whichever one sorts first;
 *  - the stored id is only ever a *hint*: `resolveSelectedBdAddr` re-checks it
 *    against what this account still owns on every device fetch, so a device
 *    released on another machine cannot leave this one pointing at nothing;
 *  - it is shared between the two pages deliberately — whichever device was
 *    last looked at anywhere is the one both open on.
 *
 * The reconciliation effect runs on every render rather than keying off a
 * joined-bd-address string (which is what forced the old
 * `eslint-disable react-hooks/exhaustive-deps`, review FE-08). That is safe and
 * cheap because it resolves from the *current* state via the functional setter:
 * when the answer is unchanged React bails out without re-rendering, so an
 * honest dependency list costs nothing.
 */
export function useSelectedDevice(devices: Array<Pick<DeviceResponse, 'bdAddr'>>): SelectedDevice {
  const lastDeviceBdAddr = useUiPreferences((s) => s.lastDeviceBdAddr);
  const setLastDeviceBdAddr = useUiPreferences((s) => s.setLastDeviceBdAddr);
  const [selectedBdAddr, setSelectedBdAddr] = useState<string | null>(null);

  useEffect(() => {
    setSelectedBdAddr((current) => resolveSelectedBdAddr(devices, current ?? lastDeviceBdAddr));
  }, [devices, lastDeviceBdAddr]);

  // Remember the choice for the next visit (and so Devices can highlight it).
  useEffect(() => {
    if (selectedBdAddr) {
      setLastDeviceBdAddr(selectedBdAddr);
    }
  }, [selectedBdAddr, setLastDeviceBdAddr]);

  return { selectedBdAddr, setSelectedBdAddr };
}
