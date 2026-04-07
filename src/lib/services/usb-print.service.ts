/// <reference path="../types/web-apis.d.ts" />
import { Injectable } from '@angular/core';
import type { DetectedPrinter, PrintResult } from '../models/print.models';

/** USB class code for printers */
const PRINTER_CLASS = 7;

/**
 * Print driver using the WebUSB API.
 * Sends ESC/POS commands directly to USB-connected POS printers.
 *
 * **Important**: `print()` never opens a browser picker.
 * The user must call `pair()` once per browser to authorize a device.
 * After that, `print()` reuses the authorized device silently.
 */
@Injectable({ providedIn: 'root' })
export class UsbPrintService {
  private device: USBDevice | null = null;
  private printerInterface: number | null = null;
  private outEndpoint: number | null = null;

  /**
   * Checks if the WebUSB API is available in the current browser.
   */
  isAvailable(): boolean {
    return typeof navigator !== 'undefined' && 'usb' in navigator;
  }

  /**
   * Checks if a USB printer is already authorized in this browser.
   * Does NOT open a picker — only checks previously paired devices.
   */
  async isConnected(): Promise<boolean> {
    if (!this.isAvailable()) return false;
    if (this.device?.opened) return true;
    try {
      const devices = await navigator.usb.getDevices();
      return devices.some((d) => this.isPrinter(d));
    } catch {
      return false;
    }
  }

  /**
   * Detects all previously authorized USB printers without showing a picker.
   */
  async detect(): Promise<DetectedPrinter[]> {
    if (!this.isAvailable()) return [];
    try {
      const devices = await navigator.usb.getDevices();
      return devices
        .filter((d) => this.isPrinter(d))
        .map((d) => ({
          driver: 'usb' as const,
          name: d.productName ?? `USB Device ${d.vendorId}:${d.productId}`,
          connected: true,
        }));
    } catch {
      return [];
    }
  }

  /**
   * Opens the browser device picker so the user can authorize a USB printer.
   * **Required once per browser.** After this, `print()` works silently.
   *
   * @returns The paired device info, or null if the user cancelled
   */
  async pair(): Promise<DetectedPrinter | null> {
    if (!this.isAvailable()) return null;
    try {
      const device = await navigator.usb.requestDevice({
        filters: [{ classCode: PRINTER_CLASS }],
      });
      return {
        driver: 'usb',
        name: device.productName ?? `USB Device ${device.vendorId}:${device.productId}`,
        connected: true,
      };
    } catch {
      return null;
    }
  }

  /**
   * Sends ESC/POS data to an already-authorized USB printer.
   * **Never opens a picker.** If no device is authorized, returns an error.
   * Call `pair()` first to authorize a device.
   */
  async print(data: Uint8Array): Promise<PrintResult> {
    try {
      if (!this.isAvailable()) {
        return {
          success: false,
          driver: 'usb',
          error: 'WebUSB API is not available in this browser.',
          timestamp: Date.now(),
        };
      }

      // Find an already-authorized device (no picker)
      if (!this.device || !this.device.opened) {
        await this.connectAuthorized();
      }

      if (!this.device || this.outEndpoint === null) {
        return {
          success: false,
          driver: 'usb',
          error: 'No authorized USB printer found. Call pair() to authorize one.',
          timestamp: Date.now(),
        };
      }

      await this.device.transferOut(this.outEndpoint, data);
      return { success: true, driver: 'usb', timestamp: Date.now() };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown USB error';
      await this.forceClose();
      return { success: false, driver: 'usb', error: message, timestamp: Date.now() };
    }
  }

  /**
   * Disconnects from the USB printer, releasing the interface.
   */
  async disconnect(): Promise<void> {
    if (this.device?.opened && this.printerInterface !== null) {
      try {
        await this.device.releaseInterface(this.printerInterface);
      } catch {
        // Interface may already be released
      }
    }
    await this.forceClose();
  }

  /**
   * Connects to a previously authorized USB printer.
   * Never shows a picker dialog.
   */
  private async connectAuthorized(): Promise<void> {
    const devices = await navigator.usb.getDevices();
    const printer = devices.find((d) => this.isPrinter(d));

    if (!printer) {
      this.device = null;
      return;
    }

    this.device = printer;

    // Always reset to a clean state first
    if (this.device.opened) {
      try { await this.device.close(); } catch { /* ignore */ }
      // Give the OS time to release the device
      await this.delay(200);
    }

    await this.device.open();

    if (this.device.configuration === null) {
      await this.device.selectConfiguration(1);
    }

    this.findPrinterEndpoint();

    if (this.printerInterface === null || this.outEndpoint === null) {
      throw new Error('No printer interface/endpoint found on this USB device.');
    }

    // Try to claim, with up to 2 retries
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await this.device.claimInterface(this.printerInterface);
        return; // Success
      } catch {
        if (attempt < 2) {
          // Release, close, wait, reopen
          try { await this.device.releaseInterface(this.printerInterface); } catch { /* ignore */ }
          try { await this.device.close(); } catch { /* ignore */ }
          await this.delay(300 * (attempt + 1));
          await this.device.open();
          if (this.device.configuration === null) {
            await this.device.selectConfiguration(1);
          }
        } else {
          throw new Error(
            'Unable to claim USB interface. Close other tabs/apps using the printer and retry.'
          );
        }
      }
    }
  }

  /** Wait for a given number of milliseconds. */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Checks if a USBDevice is a printer (class 7 at device or interface level). */
  private isPrinter(d: USBDevice): boolean {
    if (d.deviceClass === PRINTER_CLASS) return true;
    return d.configurations.some((c) =>
      c.interfaces.some((i) =>
        i.alternates.some((a) => a.interfaceClass === PRINTER_CLASS)
      )
    );
  }

  /** Finds the printer interface number and OUT endpoint number. */
  private findPrinterEndpoint(): void {
    this.printerInterface = null;
    this.outEndpoint = null;
    if (!this.device?.configuration) return;
    for (const iface of this.device.configuration.interfaces) {
      for (const alt of iface.alternates) {
        if (alt.interfaceClass === PRINTER_CLASS) {
          const out = alt.endpoints.find((ep) => ep.direction === 'out');
          if (out) {
            this.printerInterface = iface.interfaceNumber;
            this.outEndpoint = out.endpointNumber;
            return;
          }
        }
      }
    }
  }

  /** Force-closes the device and resets internal state. */
  private async forceClose(): Promise<void> {
    try {
      if (this.device?.opened) {
        await this.device.close();
      }
    } catch {
      // Ignore close errors
    }
    this.device = null;
    this.printerInterface = null;
    this.outEndpoint = null;
  }
}
