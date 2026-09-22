# Changelog

## 1.2.2 (2026-09-22)

### Bug Fixes

- **Timeouts**: every agent call is now bounded (8s to list, 20s for capabilities, 120s to
  print). A fetch with no timeout never gives up, and the agent talks to real hardware that goes
  quiet: an unplugged printer whose queue is still declared keeps its driver waiting, and a
  caller that waits with it shows a spinner that never stops. Seen in the field as a five-minute
  "searching for printers" that only a page reload cleared.

## 1.2.1 (2026-09-22)

### Bug Fixes

- **Packaging**: 1.2.0 was published from the repository root instead of `dist/`, so the
  manifest that shipped had no `module`, `typings` or `exports` and the package resolved to
  nothing. Republished from `dist/`, and a `prepublishOnly` guard now refuses a publish from
  the root. **Use 1.2.1; 1.2.0 is unusable.**

## 1.2.0 (2026-09-22)

### Features

- **Documents**: `printDocument()` prints A4 and other page documents through the local agent,
  silently. Pages are sent already rendered, one image each, so the agent needs no PDF engine
  and stays a single self-contained executable.
- **Capabilities**: `capabilities(printerId)` reads what a printer's driver declares it can do:
  papers, trays, duplex, color, maximum copies, resolution and printable area. Same source as
  the system's own settings window, so an app can offer exactly the options the machine honours.
- **Printer list**: `listPrinters()` returns every printer the host can reach, not only thermal
  ones. `detect()` keeps its thermal-only filter, since it feeds the ESC/POS routing.
- **Types**: `HostPrinter`, `PrinterOption`, `PrinterCapabilities`, `DocumentPrintOptions` and
  `DocumentPrintResult` are exported.

### Notes

- Requires Print Bridge agent 1.1 or later for the two new endpoints
  (`GET /printers/{id}/capabilities`, `POST /print-document`).
- Together these let a web app replace the system print dialog entirely: printer list, color,
  duplex, tray, paper, copies and pages chosen in the page, and the document printed with no
  window opening at all.

## 1.0.1 (2026-04-07)

### Bug Fixes

- **USB**: fix `claimInterface` failing when device was held by a previous browser session
- **USB**: retry up to 3 times with increasing delays to let the OS release the interface
- **USB**: properly `releaseInterface` before closing the device
- **Bluetooth**: silent reconnect via `getDevices()` (Chrome 92+) after browser restart
- **Window**: fix `window.print()` being called twice (double print dialog)
- **Auto-detect**: never opens a picker, only uses already-authorized devices
- **Fallback**: no more surprise `window.print()` when USB/Bluetooth is configured

## 1.0.0 (2026-04-07)

### Features

- **USB printing** via WebUSB API (Chrome, Edge, Opera, desktop + Android OTG)
- **Bluetooth printing** via Web Bluetooth API (Chrome, Edge, desktop + Android)
- **Network printing** via WebSocket (all browsers)
- **Browser fallback** via `window.print()` with thermal paper CSS (all browsers)
- **Custom driver adapter** interface for Capacitor, Cordova, Electron
- **ESC/POS builder**, fluent API to build thermal printer commands
- **Auto-detection**, silently finds the best connected printer
- **Persistent settings**, preferred driver saved in localStorage, survives restarts
- **One-time pairing**, `requestPairing()` for settings screen, then fully automatic
- **Dual Angular support**, NgModule (`forRoot`) and Standalone (`providePosPrint`)
- **Zero dependencies**, only peer deps on `@angular/core`, `@angular/common`, `rxjs`
- Compatible with Angular 15, 16, 17, 18, 19, 20, 21+
