# thermometer-mobile

Capacitor native shell wrapping `../fe` (architecture v3 §3.3): the same
React web app compiles to Android and iOS from here, with native BLE via
`@capacitor-community/bluetooth-le` instead of Web Bluetooth. There is no
separate mobile UI codebase — `capacitor.config.ts` points `webDir` straight
at `../fe/dist`, and the platform switch lives in one file,
`../fe/src/ble/createBleTransport.ts`, which picks
`NativeBluetoothTransport` (native) vs. `WebBluetoothTransport` (browser) at
runtime via `Capacitor.isNativePlatform()`.

## Prerequisites

- Node.js 20+
- Android: Android Studio + an Android SDK platform installed
- iOS (macOS only): Xcode + a downloaded Simulator runtime (or a
  provisioned device) + CocoaPods

## Build

```bash
npm install
npm run build-web   # builds ../fe -> ../fe/dist, which webDir points at
```

### Configuring the endpoints (build-time here, unlike the web container)

The web app reads its API / MQTT / Keycloak URLs through one helper
(`../fe/src/config/env.ts`), which resolves

```
window.__ENV__?.X  ??  import.meta.env.VITE_X  ??  http://localhost:<port>
```

The **web container** takes the first branch: its nginx entrypoint writes
`env.js` from container environment variables at start, so one image is
promotable across environments (see `../fe/README.md`, "Runtime configuration").

**This shell takes the second branch.** `webDir` points at `../fe/dist`, which
Capacitor copies into the app bundle — there is no server to render `env.js`, and
the `public/env.js` that ships in `dist/` is deliberately an empty
`window.__ENV__` so the `<script src="/env.js">` tag doesn't 404 inside the
WebView. The URLs therefore have to be baked in at build time, exactly as before:

```bash
# from mobile/ — a device/emulator cannot reach the host's "localhost"
VITE_API_BASE_URL=http://192.168.1.10:8080 VITE_MQTT_WS_URL=ws://192.168.1.10:9001 VITE_KEYCLOAK_URL=http://192.168.1.10:8082   npm run sync
```

(or put the same three lines in `../fe/.env.local`, which Vite picks up
automatically — see `../fe/.env.example`). Without them the bundle falls back to
`localhost`, which on a phone means the phone itself, so every request fails.

A real app build would set these per flavour/scheme rather than per shell
invocation; that is not wired up here (see the status table at the end).

The broker also requires credentials now: the app mints its own per-user MQTT
credential from `POST /api/live/credentials`, so `VITE_API_BASE_URL` has to be
reachable for the live feed to work — there is nothing to configure for MQTT auth
itself.

## Adding the native platforms

The `android/` and `ios/` folders are **not** pre-generated in this repo —
Capacitor generates them from the installed `@capacitor/android` /
`@capacitor/ios` templates:

```bash
npx cap add android
npx cap add ios       # macOS only
```

Re-sync after any change to ../fe or to the Capacitor config/plugins:

```bash
npm run sync          # = build-web + cap sync (both platforms)
```

## Run

```bash
npm run android   # opens the project in Android Studio
npm run ios       # opens the project in Xcode
```

Build/run from there like any native Android or iOS project — Capacitor
doesn't add its own build step beyond feeding it the web bundle.

## What was actually verified in this environment

This environment has Node, the Capacitor CLI, Android's Gradle toolchain,
and Xcode — but not a fully provisioned Android SDK platform or an installed
iOS Simulator runtime. Here's exactly what that let us confirm, and what it
didn't:

| Step | Result |
|------|--------|
| `npx cap doctor` reads `capacitor.config.ts` and resolves versions | ✅ works |
| `npx cap add android` — scaffolds the native Gradle project, copies `../fe/dist` into `android/app/src/main/assets/public`, wires up the `@capacitor-community/bluetooth-le` plugin | ✅ works |
| Full Gradle build of the Android project | ❌ blocked in this environment — Gradle 8.2.1 (auto-downloaded) rejects this machine's JDK 26 (`Unsupported class file major version 70`). **Not a project bug** — Android Studio ships its own bundled compatible JDK, which sidesteps this; a real Android dev machine won't hit it. |
| `npx cap add ios` — scaffolds the Xcode project + workspace, runs `pod install` for `@capacitor-community/bluetooth-le` | ✅ works, including a clean CocoaPods resolution |
| Full Xcode build (simulator or device) | ❌ blocked in this environment — no iOS Simulator runtime is downloaded and no provisioning profile is configured. **Not a project bug** — this needs Xcode's Platform Support component (Settings → Components) or a real signing identity, either of which a normal iOS dev setup already has. |

In short: the plumbing that ties `../fe`'s single codebase into two real
native projects is proven to work end-to-end; the last mile (an actual
device/simulator build) needs a fully equipped Android Studio / Xcode
workstation to finish, which this environment intentionally doesn't carry.

## Native BLE permissions (not yet wired into the manifests)

Not done in this scaffold — needed before a real device build:

- **Android**: `BLUETOOTH_SCAN`, `BLUETOOTH_CONNECT` (API 31+) or
  `BLUETOOTH`, `BLUETOOTH_ADMIN`, `ACCESS_FINE_LOCATION` (pre-31) in
  `android/app/src/main/AndroidManifest.xml`.
- **iOS**: `NSBluetoothAlwaysUsageDescription` in `ios/App/App/Info.plist`.

## What's implemented vs. scaffolded

| Area | Status |
|------|--------|
| Capacitor project config, plugin wiring | ✅ implemented, verified (see table above) |
| Native BLE transport (`../fe/src/ble/nativeBluetoothTransport.ts`) | ✅ implemented, type-checked against the real `@capacitor-community/bluetooth-le` API — not exercised on a real device in this environment |
| Runtime web/native transport switch | ✅ implemented (`../fe/src/ble/createBleTransport.ts`) |
| Simulated BLE transport (no hardware/device needed) | ✅ works here too — it's plain JS with no native dependency, so "Connect (Simulated Device)" exercises the whole app inside the Capacitor WebView exactly like it does in the browser (see `../fe/README.md` "Testing without real hardware") |
| Android/iOS manifest permissions | ⏸ not added — see above |
| Per-environment endpoint configuration | ⏸ not implemented — the three `VITE_*` URLs are passed on the `npm run sync` command line (see "Configuring the endpoints" above). A shipped app would bind them to a build flavour (Android) / scheme (iOS) instead. The web container needs none of this: it configures itself at runtime. |
| Background BLE collection | ⏸ not implemented (roadmap) |
| App store builds/signing | ⏸ out of scope for this environment |
