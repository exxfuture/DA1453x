import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Cross-navigation UI state (localStorage-persisted) — things the app should
 * remember between pages and visits, as opposed to `store.ts`'s ephemeral
 * BLE-connection state.
 *
 * The dashboard's device selection lives here rather than in component state
 * or the URL: a customer with several devices who picks one, checks their
 * History or Settings, and comes back expects to still be looking at *their*
 * choice — not whichever device happens to sort first. The stored id is only
 * ever a *preference*: it is revalidated against the owned-device list on
 * every load (see utils/devices.ts#resolveSelectedBdAddr), so releasing a
 * device on another machine can't leave this one pointing at nothing.
 */
interface UiPreferencesState {
  /** Last device the customer looked at (bd_addr). */
  lastDeviceBdAddr: string | null;
  setLastDeviceBdAddr: (bdAddr: string | null) => void;
}

export const useUiPreferences = create<UiPreferencesState>()(
  persist(
    (set) => ({
      lastDeviceBdAddr: null,
      setLastDeviceBdAddr: (lastDeviceBdAddr) => set({ lastDeviceBdAddr }),
    }),
    { name: 'thermometer-ui-preferences' },
  ),
);
