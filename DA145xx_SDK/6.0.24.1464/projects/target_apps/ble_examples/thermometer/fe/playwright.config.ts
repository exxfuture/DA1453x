import { defineConfig } from '@playwright/test';

// Points at the already-running docker-compose stack (`docker compose up`)
// rather than spawning its own dev server — this is meant to test the real
// deployed artifact end-to-end, not a special test build.
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8090',
    headless: true,
    screenshot: 'only-on-failure',
  },
  reporter: [['list']],
});
