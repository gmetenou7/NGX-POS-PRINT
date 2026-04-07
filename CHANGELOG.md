# Changelog

## 1.0.0 (2026-04-07)

### Features

- **USB printing** via WebUSB API (Chrome, Edge, Opera — desktop + Android OTG)
- **Bluetooth printing** via Web Bluetooth API (Chrome, Edge — desktop + Android)
- **Network printing** via WebSocket (all browsers)
- **Browser fallback** via `window.print()` with thermal paper CSS (all browsers)
- **Custom driver adapter** interface for Capacitor, Cordova, Electron
- **ESC/POS builder** — fluent API to build thermal printer commands
- **Auto-detection** — silently finds the best connected printer
- **Persistent settings** — preferred driver saved in localStorage, survives restarts
- **One-time pairing** — `requestPairing()` for settings screen, then fully automatic
- **Dual Angular support** — NgModule (`forRoot`) and Standalone (`providePosPrint`)
- **Zero dependencies** — only peer deps on `@angular/core`, `@angular/common`, `rxjs`
- Compatible with Angular 15, 16, 17, 18, 19, 20, 21+
