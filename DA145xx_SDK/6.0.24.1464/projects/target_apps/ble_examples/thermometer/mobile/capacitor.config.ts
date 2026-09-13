import type { CapacitorConfig } from '@capacitor/cli';

// webDir points at the fe/ project's build output — this IS the same React
// codebase as the web app (architecture v3 §3.3), not a separate mobile UI.
// Run `npm run build-web` (or just `npm run sync`) before `cap sync` so
// ../fe/dist exists.
const config: CapacitorConfig = {
  appId: 'com.dialog.thermometer',
  appName: 'Thermometer',
  webDir: '../fe/dist',
};

export default config;
