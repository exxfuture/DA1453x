import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemePreference = 'light' | 'dark' | 'system';

interface ThemeState {
  theme: ThemePreference;
  setTheme: (theme: ThemePreference) => void;
  cycleTheme: () => void;
}

function applyTheme(theme: ThemePreference) {
  if (theme === 'system') {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = theme;
  }
}

export function resolvedIsDark(theme: ThemePreference): boolean {
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'system',
      setTheme: (theme) => {
        applyTheme(theme);
        set({ theme });
      },
      cycleTheme: () => {
        // Toggle off the *resolved* (visible) state, not the raw preference
        // string — otherwise clicking from the default 'system' always
        // lands on 'light', a no-op whenever the OS is already light.
        const next: ThemePreference = resolvedIsDark(get().theme) ? 'light' : 'dark';
        applyTheme(next);
        set({ theme: next });
      },
    }),
    {
      name: 'thermometer-theme',
      onRehydrateStorage: () => (state) => {
        if (state) applyTheme(state.theme);
      },
    },
  ),
);

// Apply immediately on module load too, so the very first paint (before any
// component mounts, e.g. a hard refresh) already has the right theme —
// onRehydrateStorage alone can lag a frame behind.
applyTheme(useThemeStore.getState().theme);
