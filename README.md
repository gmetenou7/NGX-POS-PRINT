# ngx-pos-print

[![npm version](https://img.shields.io/npm/v/ngx-pos-print.svg)](https://www.npmjs.com/package/ngx-pos-print)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Angular 15+](https://img.shields.io/badge/Angular-15+-dd0031.svg)](https://angular.dev)
[![Standalone Ready](https://img.shields.io/badge/Standalone-Ready-brightgreen.svg)]()
[![Zero Dependencies](https://img.shields.io/badge/Dependencies-Zero-orange.svg)]()

**Print receipts on POS thermal printers from your Angular app. No software to install on the client machine. Works on PC and Android tablets.**

---

## What does it do?

You have an Angular app (a cash register, a restaurant POS, an e-commerce back-office...) and you need to print receipts on a thermal printer.

This library lets you do that **directly from the browser**, without installing any driver, desktop app, or browser extension on the client machine.

```
Your Angular App  --->  ngx-pos-print  --->  Thermal Printer
                         (this library)       (USB, Bluetooth, or Network)
```

---

## How it works

```
                    print() called
                         |
        +---------+------+------+---------+
        |         |             |         |
      USB    Bluetooth      Network    Browser
    (WebUSB)  (Web BT)    (WebSocket)  (window.print)
        |         |             |         |
        v         v             v         v
    Direct     Direct       Direct     OS Print
    to device  to device    to device  Dialog
```

**The library auto-detects your printer.** You pair it once in the settings, then every print is automatic — zero popups, zero dialogs.

---

## Supported platforms

| Connection    | Chrome / Edge | Android Chrome | Android Capacitor | Firefox / Safari | iOS    |
|---------------|:------------:|:--------------:|:-----------------:|:----------------:|:------:|
| **USB**       | Yes          | Yes (OTG)      | Custom driver      | No               | No     |
| **Bluetooth** | Yes          | Yes            | Custom driver      | No               | No     |
| **Network**   | Yes          | Yes            | Yes                | Yes              | Yes    |
| **Browser**   | Yes          | Yes            | Yes                | Yes              | Yes    |

> **USB and Bluetooth** require a Chromium-based browser (Chrome, Edge, Opera, Brave).  
> **Network and Browser** work on every browser.  
> **Capacitor/Cordova apps**: use the custom driver adapter (see below).

---

## Installation

```bash
npm install ngx-pos-print
```

That's it. No other package to install.

**Requirements:**
- Angular 15 or higher
- RxJS 7 or higher

---

## Setup (choose one)

### Option A: Standalone app (recommended, Angular 15+)

Open your `app.config.ts`:

```typescript
import { providePosPrint } from 'ngx-pos-print';

export const appConfig: ApplicationConfig = {
  providers: [
    providePosPrint({ paperSize: 80 })   // 80mm paper (standard) or 58mm
  ]
};
```

### Option B: NgModule app

Open your `app.module.ts`:

```typescript
import { NgxPosPrintModule } from 'ngx-pos-print';

@NgModule({
  imports: [
    NgxPosPrintModule.forRoot({ paperSize: 80 })
  ]
})
export class AppModule {}
```

---

## Usage: 2 steps

### Step 1: Pair the printer (once, in your settings page)

The user must authorize the printer **one time** per browser. After that, it's remembered forever.

```typescript
import { Component, inject } from '@angular/core';
import { PosPrintService } from 'ngx-pos-print';

@Component({
  template: `
    <h2>Printer Setup</h2>
    <button (click)="pairUsb()">Connect USB Printer</button>
    <button (click)="pairBluetooth()">Connect Bluetooth Printer</button>
  `
})
export class SettingsComponent {
  private posPrint = inject(PosPrintService);

  async pairUsb() {
    const printer = await this.posPrint.requestPairing('usb');
    if (printer) {
      alert('Printer connected: ' + printer.name);
      // The library automatically saves "usb" as the preferred driver.
      // Next time the app starts, it will use USB automatically.
    }
  }

  async pairBluetooth() {
    const printer = await this.posPrint.requestPairing('bluetooth');
    if (printer) {
      alert('Printer connected: ' + printer.name);
    }
  }
}
```

> **What happens:** The browser shows a device picker. The user selects their printer. Done. This never happens again — the printer is remembered across browser restarts, device reboots, everything.

### Step 2: Print (in your POS/cash register page)

```typescript
import { Component, inject } from '@angular/core';
import { PosPrintService, EscPosBuilder } from 'ngx-pos-print';

@Component({
  template: `<button (click)="printReceipt()">Print Receipt</button>`
})
export class CashRegisterComponent {
  private posPrint = inject(PosPrintService);

  async printReceipt() {
    const receipt = new EscPosBuilder()
      .reset()
      .align('center')
      .bold('MY STORE')
      .newLine()
      .text('123 Main Street')
      .newLine(2)
      .separator('=')
      .align('left')
      .text('Coffee x2             $8.00')
      .newLine()
      .text('Sandwich              $5.50')
      .newLine()
      .separator()
      .align('right')
      .bold('TOTAL: $13.50')
      .newLine(2)
      .align('center')
      .text('Thank you for your visit!')
      .newLine()
      .text('2026-04-07 15:30')
      .feed(3)
      .cut()
      .build();

    const result = await this.posPrint.print(receipt);

    if (result.success) {
      console.log('Printed on', result.driver);
    } else {
      console.error('Print failed:', result.error);
    }
  }
}
```

> **What happens:** The receipt is sent directly to the printer. No dialog, no popup. The printer prints it and cuts the paper.

---

## Alternative: Print with lines (no builder needed)

If you prefer not to use the EscPosBuilder, you can pass an array of line objects:

```typescript
import { PosPrintService, type PrintLine } from 'ngx-pos-print';

const lines: PrintLine[] = [
  { type: 'text', content: 'MY STORE', align: 'center', bold: true },
  { type: 'separator' },
  { type: 'text', content: 'Coffee x2             $8.00' },
  { type: 'text', content: 'Sandwich              $5.50' },
  { type: 'separator' },
  { type: 'text', content: 'TOTAL: $13.50', align: 'right', bold: true },
  { type: 'newline' },
  { type: 'text', content: 'Thank you!', align: 'center' },
  { type: 'cut' },
];

const result = await this.posPrint.printLines(lines);
```

---

## Detect connected printers

```typescript
const printers = await this.posPrint.detect();
// [
//   { driver: 'usb', name: 'USB Printer Port', connected: true },
//   { driver: 'window', name: 'Browser Print', connected: true }
// ]
```

This is silent — no popup, no dialog. Use it to show the user which printers are available.

---

## Choose the print mode

You can set the preferred driver in 3 ways:

### 1. Automatically (recommended)

When the user pairs a printer with `requestPairing('usb')`, the library automatically saves `'usb'` as the preferred driver. It's stored in `localStorage` and survives restarts.

### 2. Manually in code

```typescript
// Set USB as default
this.posPrint.setPreferredDriver('usb');

// Set Bluetooth as default
this.posPrint.setPreferredDriver('bluetooth');

// Reset to auto-detect
this.posPrint.setPreferredDriver(null);

// Read current setting
const current = this.posPrint.preferredDriver; // 'usb' | 'bluetooth' | ... | null
```

### 3. In the global config

```typescript
providePosPrint({ driver: 'usb', paperSize: 80 })
```

---

## EscPosBuilder — Full API

The builder creates ESC/POS commands that thermal printers understand. Every method returns `this`, so you can chain them:

```typescript
const data = new EscPosBuilder(80)   // 80mm or 58mm paper
  .reset()                           // Reset printer to defaults
  .align('center')                   // 'left' | 'center' | 'right'
  .bold('BIG TITLE')                 // Bold text (auto-disables after)
  .boldOff()                         // Manually disable bold
  .underline('Underlined text')      // Underline (auto-disables after)
  .underlineOff()                    // Manually disable underline
  .doubleSize('HUGE TEXT')           // Double width + height (auto-resets)
  .normalSize()                      // Reset to normal size
  .text('Regular text')              // Print text (no newline)
  .newLine()                         // Add a newline
  .newLine(3)                        // Add 3 newlines
  .separator()                       // Print ------------ line
  .separator('=')                    // Print ============ line
  .separator('*', 20)               // Print ******************** (20 chars)
  .feed(3)                           // Feed paper 3 lines
  .cut()                             // Full paper cut
  .cut(true)                         // Partial paper cut
  .raw(new Uint8Array([0x1b, 0x40]))// Send raw bytes
  .build();                          // Returns Uint8Array
```

---

## PosPrintService — Full API

| Method | Returns | Description |
|--------|---------|-------------|
| `print(data)` | `Promise<PrintResult>` | Send ESC/POS bytes to printer |
| `print(data, { driver: 'usb' })` | `Promise<PrintResult>` | Force a specific driver |
| `printLines(lines)` | `Promise<PrintResult>` | Print from line objects |
| `detect()` | `Promise<DetectedPrinter[]>` | List connected printers (silent) |
| `requestPairing('usb')` | `Promise<DetectedPrinter \| null>` | Open picker to pair USB |
| `requestPairing('bluetooth')` | `Promise<DetectedPrinter \| null>` | Open picker to pair Bluetooth |
| `setPreferredDriver(driver)` | `void` | Save default driver (persisted) |
| `preferredDriver` | `PrintDriver \| null` | Get saved default driver |
| `getAvailableDrivers()` | `PrintDriver[]` | List available driver APIs |
| `registerDriver(adapter)` | `void` | Register custom driver |
| `onPrintResult$` | `Observable<PrintResult>` | All print results stream |
| `lastPrintResult` | `PrintResult \| null` | Last print result |

---

## Configuration

```typescript
providePosPrint({
  driver: 'usb',           // Force a driver: 'usb' | 'bluetooth' | 'network' | 'window'
                            // Default: auto-detect
  paperSize: 80,            // Paper width: 80 (standard) or 58 (small)
                            // Default: 80
  networkIp: '192.168.1.50',// IP for network printing
  networkPort: 9100,        // Port for network printing (default: 9100)
  bluetoothServiceUUID: '...', // Override Bluetooth service UUID
  debug: true,              // Log to console
})
```

---

## Capacitor / Cordova / Electron

WebUSB and Web Bluetooth are **not available** in WebView. But you can bridge any native API using the custom driver interface:

```typescript
import { PrintDriverAdapter, PrintResult, DetectedPrinter } from 'ngx-pos-print';

// Example: Capacitor Bluetooth Serial plugin
export class CapacitorBluetoothAdapter implements PrintDriverAdapter {
  readonly name = 'capacitor-bluetooth';
  readonly priority = -1;   // Tried before web drivers

  async isAvailable(): Promise<boolean> {
    return 'Capacitor' in window;
  }

  async isConnected(): Promise<boolean> {
    // Use your Capacitor plugin here
    return true;
  }

  async connect(): Promise<void> {
    // Use your Capacitor plugin here
  }

  async print(data: Uint8Array): Promise<PrintResult> {
    // Send data via your Capacitor plugin
    return { success: true, driver: 'custom', timestamp: Date.now() };
  }

  async detect(): Promise<DetectedPrinter[]> {
    return [{ driver: 'custom', name: 'BT Printer', connected: true }];
  }

  async disconnect(): Promise<void> {
    // Cleanup
  }
}
```

Register it at bootstrap:

```typescript
providePosPrint({ paperSize: 80 }, [new CapacitorBluetoothAdapter()])
```

Or at runtime:

```typescript
this.posPrint.registerDriver(new CapacitorBluetoothAdapter());
```

---

## Windows setup (for USB)

On Windows, the default `usbprint.sys` driver blocks WebUSB access. You need to replace it with the **WinUSB** driver.

**Use the companion installer:** [POS Printer Driver Installer for Windows](https://github.com/gmetenou7/POS-PRINTER-DRIVER-FOR-NGX-POS-PRINT-IN-WINDOWS)

```
1. Download POS-Printer-Driver-Installer.exe
2. Plug in your POS printer
3. Run the installer and select your printer
4. Done — WebUSB now works!
```

> This only needs to be done **once per printer**. The change survives reboots.

---

## Linux setup (for USB)

On Linux, Chrome needs permission to access USB devices. Run once:

```bash
# Replace VENDOR_ID and PRODUCT_ID with your printer's values
# Find them with: lsusb
sudo tee /etc/udev/rules.d/99-pos-printer.rules << 'EOF'
SUBSYSTEM=="usb", ATTR{idVendor}=="VENDOR_ID", ATTR{idProduct}=="PRODUCT_ID", MODE="0666"
EOF

sudo udevadm control --reload-rules
sudo udevadm trigger

# If the kernel printer driver blocks access:
sudo rmmod usblp
echo "blacklist usblp" | sudo tee /etc/modprobe.d/no-usblp.conf
```

Then unplug and replug the printer.

> **Windows (USB)**: You **must** install the WinUSB driver first. See [POS Printer Driver Installer for Windows](https://github.com/gmetenou7/POS-PRINTER-DRIVER-FOR-NGX-POS-PRINT-IN-WINDOWS).  
> **macOS**: no extra setup needed.  
> **Android**: no extra setup needed.

---

## Complete example: POS app with settings

```typescript
// === app.config.ts ===
import { providePosPrint } from 'ngx-pos-print';

export const appConfig = {
  providers: [providePosPrint({ paperSize: 80 })]
};

// === settings.component.ts (admin does this once) ===
@Component({
  template: `
    <button (click)="setup()">Setup USB Printer</button>
    <p>Current mode: {{ posPrint.preferredDriver ?? 'auto' }}</p>
  `
})
export class SettingsComponent {
  posPrint = inject(PosPrintService);

  async setup() {
    const p = await this.posPrint.requestPairing('usb');
    if (p) alert('Ready: ' + p.name);
  }
}

// === pos.component.ts (cashier uses this daily) ===
@Component({
  template: `<button (click)="print()">Print Receipt</button>`
})
export class PosComponent {
  private posPrint = inject(PosPrintService);

  async print() {
    const data = new EscPosBuilder()
      .reset()
      .align('center').bold('MY STORE').newLine()
      .separator()
      .align('left').text('Item 1    $10.00').newLine()
      .separator()
      .align('right').bold('TOTAL: $10.00').newLine()
      .feed(3).cut()
      .build();

    const result = await this.posPrint.print(data);
    // result.success === true  -->  printed!
    // result.success === false -->  show error to user
  }
}
```

---

## FAQ

**Q: Does the user need to install anything?**  
A: No. Nothing. It works directly in the browser.

**Q: Does it work on Android tablets?**  
A: Yes. USB (via OTG cable) and Bluetooth both work on Chrome for Android.

**Q: What if the browser doesn't support USB/Bluetooth?**  
A: The library detects this automatically. On Firefox or Safari, use Network (WebSocket) or the browser print dialog.

**Q: Is the printer pairing permanent?**  
A: Yes. It survives browser restarts, device reboots, and app updates. The user pairs once, then never again.

**Q: Can I use this without Angular?**  
A: No, this is an Angular library. For vanilla JS, look at `escpos` or `webusb-printer` packages.

**Q: What printers are supported?**  
A: Any ESC/POS compatible thermal printer. This includes most POS printers: Epson TM series, Star TSP series, Bixolon, Rongta, Xprinter, etc.

---

## Ecosystem — do I need the driver installer?

`ngx-pos-print` works on **all platforms** (Windows, macOS, Linux, Android). But on **Windows only**, USB printing requires an extra one-time step.

### Why?

Windows ships with a driver called `usbprint.sys` that takes **exclusive control** of USB printers. This blocks WebUSB from accessing the printer. The companion project replaces that driver with **WinUSB**, which allows the browser to communicate directly with the printer.

### When do I need it?

| Platform | USB | Bluetooth | Network | Browser |
|----------|:---:|:---------:|:-------:|:-------:|
| **Windows** | **Driver needed** | No setup | No setup | No setup |
| **macOS** | No setup | No setup | No setup | No setup |
| **Linux** | udev rules (see above) | No setup | No setup | No setup |
| **Android** | No setup | No setup | No setup | No setup |

> **Only Windows + USB** requires the driver installer. All other combinations work out of the box.

### The two projects

| Project | What it does | When you need it |
|---------|-------------|-----------------|
| **[ngx-pos-print](https://github.com/gmetenou7/NGX-POS-PRINT)** | Angular library that sends ESC/POS commands to thermal printers via USB, Bluetooth, Network, or browser print | **Always** — this is the library you install in your Angular app |
| **[POS Printer Driver Installer](https://github.com/gmetenou7/POS-PRINTER-DRIVER-FOR-NGX-POS-PRINT-IN-WINDOWS)** | One-click installer that replaces the Windows USB driver with WinUSB | **Only on Windows**, and **only if you use USB printing** |

```
                        ┌─────────────────────────────────┐
                        │        Your Angular App          │
                        └──────────────┬──────────────────┘
                                       │
                                       ▼
                        ┌─────────────────────────────────┐
                        │         ngx-pos-print            │
                        │  (npm install ngx-pos-print)     │
                        └──┬──────┬──────────┬──────────┘
                           │      │          │       │
                         USB  Bluetooth  Network  Browser
                           │      │          │       │
                           ▼      ▼          ▼       ▼
                       Printer  Printer   Printer  OS Dialog
                           ▲
                           │
              ┌────────────┴─────────────┐
              │  POS Printer Driver       │
              │  Installer (Windows only) │
              │  Run once per printer     │
              └──────────────────────────┘
```

---

## License

[MIT](LICENSE)

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md)
