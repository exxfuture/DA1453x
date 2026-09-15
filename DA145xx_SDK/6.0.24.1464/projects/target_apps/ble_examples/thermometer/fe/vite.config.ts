/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  build: {
    rollupOptions: {
      output: {
        /**
         * Vendor splitting, on top of the per-role `React.lazy()` boundaries in
         * src/App.tsx (review FE-31). Without it the role chunks would each pull
         * their own copy of recharts' d3 dependencies, and the long-lived
         * libraries would be invalidated by every application change.
         *
         * Grouped by change cadence and by who needs them:
         *  - `charts` (recharts + d3) is the single biggest dependency and is
         *    only needed once a page actually plots something;
         *  - `auth` (oidc-client-ts) is needed before anything else renders;
         *  - `mqtt` is only pulled in by the Connect page's live feed;
         *  - `react-vendor` is the framework, which changes least often of all.
         */
        manualChunks: (id) => {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/]node_modules[\\/](recharts|d3-|victory|internmap|decimal)/.test(id)) return 'charts';
          if (/[\\/]node_modules[\\/](oidc-client-ts|react-oidc-context|jwt-decode|crypto-js)/.test(id)) return 'auth';
          if (/[\\/]node_modules[\\/](mqtt|mqtt-packet|ws|readable-stream|duplexify|help-me|bl)/.test(id)) return 'mqtt';
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler|react-router)/.test(id)) return 'react-vendor';
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    exclude: ['node_modules/**', 'e2e/**'], // e2e/ is Playwright, run via `npm run test:e2e`
  },
});
