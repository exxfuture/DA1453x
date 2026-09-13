import { create } from 'zustand';

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'error';

interface ThermometerState {
  status: ConnectionStatus;
  temperature: number | null;
  lastReadingAt: Date | null;
  errorMessage: string;
  deviceId: string | null;
  deviceName: string | null;
  setStatus: (status: ConnectionStatus) => void;
  setReading: (celsius: number) => void;
  setError: (message: string) => void;
  setDevice: (id: string, name: string) => void;
  reset: () => void;
}

export const useThermometerStore = create<ThermometerState>((set) => ({
  status: 'idle',
  temperature: null,
  lastReadingAt: null,
  errorMessage: '',
  deviceId: null,
  deviceName: null,
  setStatus: (status) => set({ status }),
  setReading: (temperature) => set({ temperature, lastReadingAt: new Date() }),
  setError: (errorMessage) => set({ status: 'error', errorMessage }),
  setDevice: (deviceId, deviceName) => set({ deviceId, deviceName }),
  reset: () =>
    set({
      status: 'idle',
      temperature: null,
      lastReadingAt: null,
      errorMessage: '',
      deviceId: null,
      deviceName: null,
    }),
}));
