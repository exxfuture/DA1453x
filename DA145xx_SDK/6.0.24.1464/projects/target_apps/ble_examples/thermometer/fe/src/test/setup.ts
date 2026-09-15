import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeAll, vi } from 'vitest';

/**
 * Shared jsdom setup for the component tests (review FE-11). Loaded by
 * `vite.config.ts`'s `test.setupFiles`, so it applies to every spec — the pure
 * logic ones simply don't exercise any of it.
 */

// React Testing Library's auto-cleanup only registers itself when it can detect
// the test framework's globals; registering it here is unconditional.
afterEach(() => {
  cleanup();
});

/**
 * A working in-memory `Storage`.
 *
 * Node ≥ 24 exposes experimental global `localStorage`/`sessionStorage` objects
 * that win over jsdom's inside vitest but implement almost none of the interface
 * — any `setItem` throws "storage.setItem is not a function". That breaks
 * zustand's `persist` middleware (state/uiStore.ts, state/themeStore.ts) and is
 * what the old `NODE_OPTIONS=--no-experimental-webstorage` in the test script was
 * working around. Replacing them here fixes it for `npx vitest run` too, with no
 * flag to remember and no production code shaped around the test environment.
 */
function memoryStorage(): Storage {
  const entries = new Map<string, string>();
  return {
    get length() {
      return entries.size;
    },
    key: (index: number) => [...entries.keys()][index] ?? null,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => void entries.set(key, String(value)),
    removeItem: (key: string) => void entries.delete(key),
    clear: () => entries.clear(),
  };
}

// Installed at module scope, NOT in a beforeAll: vitest runs setup files before
// it imports the test module, and zustand's `persist` captures `localStorage`
// once when the store module is first imported — which is during collection,
// before any hook has run.
for (const name of ['localStorage', 'sessionStorage'] as const) {
  const existing: unknown = window[name];
  const usable =
    existing != null &&
    typeof (existing as Storage).setItem === 'function' &&
    typeof (existing as Storage).getItem === 'function';
  if (!usable) {
    Object.defineProperty(window, name, { configurable: true, writable: true, value: memoryStorage() });
  }
}

beforeAll(() => {
  // jsdom implements neither of these, and recharts' ResponsiveContainer and
  // the theme store's `prefers-color-scheme` listener both call them on mount.
  if (!window.matchMedia) {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  }
  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});
