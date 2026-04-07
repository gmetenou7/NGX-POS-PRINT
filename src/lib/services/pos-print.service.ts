import { Injectable, inject } from '@angular/core';
import { Subject, type Observable } from 'rxjs';
import type { DetectedPrinter, PosPrintConfig, PrintDriver, PrintDriverAdapter, PrintLine, PrintResult } from '../models/print.models';
import { POS_PRINT_CONFIG, POS_PRINT_CUSTOM_DRIVERS } from '../providers/pos-print.providers';
import { EscPosBuilder } from '../builders/escpos-builder';
import { BluetoothPrintService } from './bluetooth-print.service';
import { NetworkPrintService } from './network-print.service';
import { UsbPrintService } from './usb-print.service';
import { WindowPrintService } from './window-print.service';

/**
 * Main service for POS thermal printing.
 *
 * **Designed for POS/cash register apps:**
 * - Settings screen: call `requestPairing()` once to authorize a printer
 * - POS screen: call `printLines()` — prints directly, no popups, no dialogs
 *
 * Configure the default driver via `providePosPrint({ driver: 'usb' })`
 * so all print calls use that driver without auto-detection.
 */
/** localStorage key for persisting the preferred driver */
const STORAGE_KEY = 'ngx-pos-print:driver';

@Injectable({ providedIn: 'root' })
export class PosPrintService {
  private readonly config = inject(POS_PRINT_CONFIG, { optional: true }) ?? {};
  private readonly bluetooth = inject(BluetoothPrintService);
  private readonly network = inject(NetworkPrintService);
  private readonly usb = inject(UsbPrintService);
  private readonly windowPrint = inject(WindowPrintService);
  private readonly customDrivers = inject(POS_PRINT_CUSTOM_DRIVERS, { optional: true }) ?? [];

  private readonly printResult$$ = new Subject<PrintResult>();

  /** Observable that emits after every print operation (success or failure). */
  readonly onPrintResult$: Observable<PrintResult> = this.printResult$$.asObservable();

  private _lastPrintResult: PrintResult | null = null;

  /** Returns the last print result, or null if no print has been performed. */
  get lastPrintResult(): PrintResult | null {
    return this._lastPrintResult;
  }

  /**
   * Returns the saved preferred driver.
   * Persists across browser restarts, device reboots, and Capacitor app restarts.
   */
  get preferredDriver(): PrintDriver | null {
    // Config takes priority over saved preference
    if (this.config.driver) return this.config.driver;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? saved as PrintDriver : null;
    } catch {
      return null;
    }
  }

  /**
   * Saves the preferred driver. Persisted in localStorage.
   * Survives browser restarts, device reboots, and Capacitor app restarts.
   *
   * @param driver - The driver to use by default, or null to reset to auto-detect
   *
   * @example
   * ```typescript
   * // In settings screen, after pairing
   * posPrint.setPreferredDriver('usb');
   *
   * // Reset to auto-detect
   * posPrint.setPreferredDriver(null);
   * ```
   */
  setPreferredDriver(driver: PrintDriver | null): void {
    try {
      if (driver) {
        localStorage.setItem(STORAGE_KEY, driver);
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // localStorage not available (SSR)
    }
  }

  /** Registers a custom driver adapter at runtime. */
  registerDriver(adapter: PrintDriverAdapter): void {
    this.customDrivers.push(adapter);
    this.customDrivers.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
  }

  /**
   * Opens the browser device picker to authorize a USB or Bluetooth printer.
   * **Call this from a settings/admin screen — never from the POS screen.**
   * After pairing, all print methods work silently.
   *
   * Automatically saves the paired driver as the preferred driver.
   */
  async requestPairing(type: 'usb' | 'bluetooth'): Promise<DetectedPrinter | null> {
    let result: DetectedPrinter | null = null;
    if (type === 'usb') result = await this.usb.pair();
    if (type === 'bluetooth') result = await this.bluetooth.pair();

    // Auto-save as preferred driver
    if (result) {
      this.setPreferredDriver(type);
    }
    return result;
  }

  /**
   * Scans all drivers and returns detected printers.
   * **100% silent — never opens a picker.**
   */
  async detect(): Promise<DetectedPrinter[]> {
    const customResults = await Promise.all(
      this.customDrivers.map((d) => d.detect().catch(() => [] as DetectedPrinter[]))
    );

    const [usbPrinters, btPrinters, netPrinters] = await Promise.all([
      this.usb.detect(),
      this.bluetooth.detect(),
      this.network.detect(),
    ]);

    const customPrinters = ([] as DetectedPrinter[]).concat(...customResults);
    const printers: DetectedPrinter[] = [
      ...customPrinters,
      ...usbPrinters,
      ...btPrinters,
      ...netPrinters,
    ];

    if (this.windowPrint.isAvailable()) {
      printers.push({ driver: 'window', name: 'Impression navigateur', connected: true });
    }

    return printers;
  }

  /**
   * Sends raw ESC/POS data to the printer.
   *
   * Driver resolution order:
   * 1. `config.driver` passed to this call
   * 2. `preferredDriver` saved via setPreferredDriver() (persisted in localStorage)
   * 3. Global config from providePosPrint()
   * 4. Auto-detect the first connected device
   *
   * **Never opens a picker or dialog.**
   */
  async print(data: Uint8Array, config?: PosPrintConfig): Promise<PrintResult> {
    const merged = { ...this.config, ...config };
    const driver = merged.driver ?? this.preferredDriver ?? await this.detectBestDriver(merged);
    const result = await this.dispatch(data, driver, merged);

    this._lastPrintResult = result;
    this.printResult$$.next(result);

    if (merged.debug) {
      // eslint-disable-next-line no-console
      console.log('[ngx-pos-print]', driver, result);
    }

    return result;
  }

  /**
   * Prints from PrintLines. The recommended method for POS apps.
   *
   * - If driver is 'window': renders HTML and uses browser print dialog
   * - Otherwise: builds ESC/POS commands and sends directly to the printer
   *
   * **Never falls back to window.print() silently.**
   * If USB is configured and fails, you get an error — not a surprise browser dialog.
   */
  async printLines(lines: PrintLine[], config?: PosPrintConfig): Promise<PrintResult> {
    const merged = { ...this.config, ...config };
    const paperSize = merged.paperSize ?? 80;
    const driver = merged.driver ?? this.preferredDriver ?? await this.detectBestDriver(merged);

    if (driver === 'window') {
      return this.emitResult(await this.windowPrint.print(lines, paperSize));
    }

    const data = this.buildEscPos(lines, paperSize);
    return this.print(data, { ...config, driver });
  }

  /** Returns available driver types (API-level, not device-level). */
  getAvailableDrivers(): PrintDriver[] {
    const drivers: PrintDriver[] = [];
    if (this.customDrivers.length > 0) drivers.push('custom');
    if (this.usb.isAvailable()) drivers.push('usb');
    if (this.bluetooth.isAvailable()) drivers.push('bluetooth');
    if (this.network.isAvailable()) drivers.push('network');
    if (this.windowPrint.isAvailable()) drivers.push('window');
    return drivers;
  }

  /**
   * Detects the best driver based on what's actually connected/authorized.
   * Priority: Custom → USB → Bluetooth → Network → Window
   */
  private async detectBestDriver(config: PosPrintConfig): Promise<PrintDriver> {
    for (const adapter of this.customDrivers) {
      try {
        if (await adapter.isAvailable() && await adapter.isConnected()) return 'custom';
      } catch { /* skip */ }
    }

    if (this.usb.isAvailable() && await this.usb.isConnected()) return 'usb';
    if (this.bluetooth.isAvailable() && await this.bluetooth.isConnected()) return 'bluetooth';
    if (config.networkIp && this.network.isAvailable() &&
        await this.network.isConnected(config.networkIp, config.networkPort)) return 'network';
    if (this.windowPrint.isAvailable()) return 'window';

    return 'window';
  }

  /** Dispatches to a specific driver. Never opens a picker. */
  private async dispatch(data: Uint8Array, driver: PrintDriver, config: PosPrintConfig): Promise<PrintResult> {
    switch (driver) {
      case 'custom': {
        for (const adapter of this.customDrivers) {
          try {
            if (!(await adapter.isAvailable())) continue;
            if (!(await adapter.isConnected())) await adapter.connect();
            return await adapter.print(data);
          } catch { continue; }
        }
        return { success: false, driver: 'custom', error: 'No custom driver available.', timestamp: Date.now() };
      }
      case 'usb':
        return this.usb.print(data);
      case 'bluetooth':
        return this.bluetooth.print(data);
      case 'network':
        return this.network.print(data, config.networkIp, config.networkPort);
      case 'window':
        return { success: false, driver: 'window', error: 'Window driver does not support raw ESC/POS. Use printLines().', timestamp: Date.now() };
      default:
        return { success: false, driver: 'window', error: 'Unknown driver.', timestamp: Date.now() };
    }
  }

  /** Builds an ESC/POS byte array from PrintLines. */
  private buildEscPos(lines: PrintLine[], paperSize: 58 | 80): Uint8Array {
    const builder = new EscPosBuilder(paperSize);
    builder.reset();
    for (const line of lines) {
      switch (line.type) {
        case 'text':
          if (line.align) builder.align(line.align);
          if (line.doubleHeight || line.doubleWidth) {
            builder.doubleSize(line.content ?? '');
          } else if (line.bold && line.underline && line.content) {
            builder.bold();
            builder.underline(line.content);
            builder.boldOff();
          } else if (line.bold && line.content) {
            builder.bold(line.content);
          } else if (line.underline && line.content) {
            builder.underline(line.content);
          } else {
            builder.text(line.content ?? '');
          }
          builder.newLine();
          break;
        case 'separator':
          builder.separator(line.content ?? '-');
          break;
        case 'newline':
          builder.newLine();
          break;
        case 'cut':
          builder.feed(3);
          builder.cut();
          break;
        case 'raw':
          if (line.raw) builder.raw(line.raw);
          break;
      }
    }
    return builder.build();
  }

  /** Stores result, emits on observable, and returns it. */
  private emitResult(result: PrintResult): PrintResult {
    this._lastPrintResult = result;
    this.printResult$$.next(result);
    return result;
  }
}
