/// <reference path="../types/web-apis.d.ts" />
import { Injectable, inject } from '@angular/core';
import type { DetectedPrinter, PrintResult } from '../models/print.models';
import { POS_PRINT_CONFIG } from '../providers/pos-print.providers';

/** Default Bluetooth GATT service UUID for POS printers */
const DEFAULT_SERVICE_UUID = '000018f0-0000-1000-8000-00805f9b34fb';
/** Default Bluetooth GATT characteristic UUID for POS printers */
const DEFAULT_CHARACTERISTIC_UUID = '00002af1-0000-1000-8000-00805f9b34fb';
/** Maximum chunk size in bytes for Bluetooth writes */
const CHUNK_SIZE = 512;

/**
 * Print driver using the Web Bluetooth API.
 *
 * **Never opens a picker during print or detect.**
 * Call `pair()` once (from a settings screen) to authorize a device.
 * After that, `print()` and `detect()` work silently.
 */
@Injectable({ providedIn: 'root' })
export class BluetoothPrintService {
  private readonly config = inject(POS_PRINT_CONFIG, { optional: true }) ?? {};
  private device: BluetoothDevice | null = null;
  private characteristic: BluetoothRemoteGATTCharacteristic | null = null;

  /**
   * Checks if the Web Bluetooth API is available in the current browser.
   */
  isAvailable(): boolean {
    return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
  }

  /**
   * Checks if a Bluetooth printer is currently connected or previously paired.
   * Never shows a picker.
   */
  async isConnected(): Promise<boolean> {
    if (!this.isAvailable()) return false;
    // Already connected in this session
    if (this.device?.gatt?.connected && this.characteristic) return true;
    // Check previously authorized devices (Chrome 92+)
    try {
      if ('getDevices' in navigator.bluetooth) {
        const devices = await navigator.bluetooth.getDevices();
        return devices.length > 0;
      }
    } catch {
      // getDevices not supported
    }
    return false;
  }

  /**
   * Detects previously authorized Bluetooth printers without showing a picker.
   */
  async detect(): Promise<DetectedPrinter[]> {
    if (!this.isAvailable()) return [];

    // Currently connected
    if (this.device?.gatt?.connected) {
      return [{
        driver: 'bluetooth',
        name: this.device.name ?? 'Bluetooth Printer',
        connected: true,
      }];
    }

    // Previously authorized (Chrome 92+)
    try {
      if ('getDevices' in navigator.bluetooth) {
        const devices = await navigator.bluetooth.getDevices();
        return devices.map((d) => ({
          driver: 'bluetooth' as const,
          name: d.name ?? 'Bluetooth Printer',
          connected: d.gatt?.connected ?? false,
        }));
      }
    } catch {
      // getDevices not supported
    }

    return [];
  }

  /**
   * Opens the browser Bluetooth picker for the user to authorize a printer.
   * **Call this once from a settings/setup screen.**
   * After this, `print()` works silently forever.
   *
   * @returns The paired device info, or null if cancelled
   */
  async pair(): Promise<DetectedPrinter | null> {
    if (!this.isAvailable()) return null;
    try {
      await this.connectWithPicker();
      return {
        driver: 'bluetooth',
        name: this.device?.name ?? 'Bluetooth Printer',
        connected: true,
      };
    } catch {
      return null;
    }
  }

  /**
   * Sends ESC/POS data to the printer. **Never opens a picker.**
   * Silently reconnects to a previously authorized device if needed.
   */
  async print(data: Uint8Array): Promise<PrintResult> {
    try {
      // Reconnect silently if not connected
      if (!this.characteristic || !this.device?.gatt?.connected) {
        await this.reconnectSilently();
      }

      if (!this.characteristic) {
        return {
          success: false,
          driver: 'bluetooth',
          error: 'No authorized Bluetooth printer. Call pair() from settings to authorize one.',
          timestamp: Date.now(),
        };
      }

      // Send data in chunks to prevent buffer overflow
      for (let offset = 0; offset < data.length; offset += CHUNK_SIZE) {
        const chunk = data.slice(offset, Math.min(offset + CHUNK_SIZE, data.length));
        await this.characteristic.writeValueWithoutResponse(chunk);
      }

      return { success: true, driver: 'bluetooth', timestamp: Date.now() };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Bluetooth error';
      return { success: false, driver: 'bluetooth', error: message, timestamp: Date.now() };
    }
  }

  /**
   * Disconnects from the Bluetooth printer.
   */
  async disconnect(): Promise<void> {
    if (this.device?.gatt?.connected) {
      this.device.gatt.disconnect();
    }
    this.device = null;
    this.characteristic = null;
  }

  /**
   * Reconnects silently to a previously authorized device.
   * Never shows a picker. Uses getDevices() (Chrome 92+).
   */
  private async reconnectSilently(): Promise<void> {
    if (!('getDevices' in navigator.bluetooth)) return;

    try {
      const devices = await navigator.bluetooth.getDevices();
      if (devices.length === 0) return;

      // Use the first authorized device
      this.device = devices[0];

      const serviceUUID = this.config.bluetoothServiceUUID ?? DEFAULT_SERVICE_UUID;
      const characteristicUUID = this.config.bluetoothCharacteristicUUID ?? DEFAULT_CHARACTERISTIC_UUID;

      const server = this.device.gatt;
      if (!server) return;

      const gatt = await server.connect();
      const service = await gatt.getPrimaryService(serviceUUID);
      this.characteristic = await service.getCharacteristic(characteristicUUID);
    } catch {
      this.characteristic = null;
    }
  }

  /**
   * Connects via the browser picker. Only used by pair().
   */
  private async connectWithPicker(): Promise<void> {
    const serviceUUID = this.config.bluetoothServiceUUID ?? DEFAULT_SERVICE_UUID;
    const characteristicUUID = this.config.bluetoothCharacteristicUUID ?? DEFAULT_CHARACTERISTIC_UUID;

    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [serviceUUID] }],
      optionalServices: [serviceUUID],
    });

    const server = this.device.gatt;
    if (!server) {
      throw new Error('Bluetooth GATT server not available on this device.');
    }

    const gatt = await server.connect();
    const service = await gatt.getPrimaryService(serviceUUID);
    this.characteristic = await service.getCharacteristic(characteristicUUID);
  }
}
