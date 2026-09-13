import { describe, expect, it } from 'vitest';
import { deviceDisplayName, resolveSelectedBdAddr } from './devices';

const owned = (bdAddr: string, label: string | null = null, model = 'DA14535') => ({ bdAddr, label, model });

describe('resolveSelectedBdAddr', () => {
  it('returns null when nothing is owned', () => {
    expect(resolveSelectedBdAddr([], 'AA:BB:CC:DD:EE:01')).toBeNull();
    expect(resolveSelectedBdAddr([], null)).toBeNull();
  });

  it('keeps the remembered choice while the device is still owned', () => {
    const devices = [owned('AA:BB:CC:DD:EE:01'), owned('AA:BB:CC:DD:EE:02')];
    expect(resolveSelectedBdAddr(devices, 'AA:BB:CC:DD:EE:02')).toBe('AA:BB:CC:DD:EE:02');
  });

  it('falls back to the first device when the remembered one was released', () => {
    const devices = [owned('AA:BB:CC:DD:EE:01'), owned('AA:BB:CC:DD:EE:02')];
    expect(resolveSelectedBdAddr(devices, 'AA:BB:CC:DD:EE:99')).toBe('AA:BB:CC:DD:EE:01');
  });

  it('falls back to the first device with no memory at all', () => {
    const devices = [owned('AA:BB:CC:DD:EE:01'), owned('AA:BB:CC:DD:EE:02')];
    expect(resolveSelectedBdAddr(devices, null)).toBe('AA:BB:CC:DD:EE:01');
    expect(resolveSelectedBdAddr(devices, undefined)).toBe('AA:BB:CC:DD:EE:01');
  });
});

describe('deviceDisplayName', () => {
  it('prefers the customer label', () => {
    expect(deviceDisplayName(owned('AA:BB:CC:DD:EE:01', "Baby's thermometer"))).toBe("Baby's thermometer");
  });

  it('falls back to the model when unnamed', () => {
    expect(deviceDisplayName(owned('AA:BB:CC:DD:EE:01'))).toBe('DA14535');
  });

  it('treats whitespace-only labels as unnamed', () => {
    expect(deviceDisplayName(owned('AA:BB:CC:DD:EE:01', '   '))).toBe('DA14535');
  });
});
