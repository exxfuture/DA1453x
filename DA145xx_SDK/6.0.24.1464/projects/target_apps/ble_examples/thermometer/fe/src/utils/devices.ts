import type { DeviceResponse } from '../api/client';

/**
 * What to show wherever a device is named — pickers, lists, chart legends.
 * The customer's own label ("Baby's thermometer") wins; without one the model
 * string is the friendliest thing left (a raw BD address means nothing to a
 * customer, and is reserved for the secondary line where space allows).
 */
export function deviceDisplayName(device: Pick<DeviceResponse, 'label' | 'model'>): string {
  const label = device.label?.trim();
  return label && label.length > 0 ? label : device.model;
}

/**
 * Reconcile a remembered/last-selected device id against the devices actually
 * owned right now: keep the choice when still valid, otherwise fall back to
 * the first device (or none). Pure so the fallback rule is unit-testable —
 * it runs on every devices fetch on the Dashboard and History pages.
 */
export function resolveSelectedBdAddr(
  devices: Array<Pick<DeviceResponse, 'bdAddr'>>,
  remembered: string | null | undefined,
): string | null {
  if (devices.length === 0) return null;
  if (remembered && devices.some((d) => d.bdAddr === remembered)) return remembered;
  return devices[0].bdAddr;
}
