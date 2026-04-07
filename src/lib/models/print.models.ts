/** Supported print drivers */
export type PrintDriver = 'bluetooth' | 'network' | 'usb' | 'window' | 'custom';

/** Text alignment for print lines */
export type TextAlign = 'left' | 'center' | 'right';

/** Supported paper widths in mm */
export type PaperSize = 58 | 80;

/** Global configuration for the POS print library */
export interface PosPrintConfig {
  /** Preferred print driver. If not set, auto-detection is used. */
  driver?: PrintDriver;
  /** Paper width in mm (58 or 80). Defaults to 80. */
  paperSize?: PaperSize;
  /** IP address for network printing */
  networkIp?: string;
  /** Port for network printing. Defaults to 9100. */
  networkPort?: number;
  /** Bluetooth GATT service UUID override */
  bluetoothServiceUUID?: string;
  /** Bluetooth GATT characteristic UUID override */
  bluetoothCharacteristicUUID?: string;
  /** Text encoding. Defaults to 'cp437'. */
  encoding?: string;
  /** Enable debug logging to console */
  debug?: boolean;
}

/** A single line or command in a print job */
export interface PrintLine {
  /** Type of print instruction */
  type: 'text' | 'separator' | 'newline' | 'cut' | 'raw';
  /** Text content (for 'text' and 'separator' types) */
  content?: string;
  /** Text alignment */
  align?: TextAlign;
  /** Bold text */
  bold?: boolean;
  /** Underlined text */
  underline?: boolean;
  /** Double-height characters */
  doubleHeight?: boolean;
  /** Double-width characters */
  doubleWidth?: boolean;
  /** Raw ESC/POS bytes (for 'raw' type) */
  raw?: Uint8Array;
}

/** A complete print job containing lines and optional config overrides */
export interface PrintJob {
  /** Lines to print */
  lines: PrintLine[];
  /** Per-job configuration overrides */
  config?: PosPrintConfig;
}

/** Result of a print operation */
export interface PrintResult {
  /** Whether the print succeeded */
  success: boolean;
  /** Which driver was used */
  driver: PrintDriver;
  /** Error message if failed */
  error?: string;
  /** Timestamp of the print operation */
  timestamp: number;
}

/** Information about a detected printer */
export interface DetectedPrinter {
  /** Driver type used to communicate with this printer */
  driver: PrintDriver;
  /** Device name if available (Bluetooth name, USB product name, etc.) */
  name?: string;
  /** Whether the printer is currently connected and ready */
  connected: boolean;
}

/**
 * Interface for custom print driver adapters.
 *
 * Implement this to bridge any native printing API
 * (Capacitor, Cordova, Electron, React Native WebView, etc.)
 * into the ngx-pos-print fallback chain.
 *
 * @example Capacitor Bluetooth adapter
 * ```typescript
 * import { BluetoothSerial } from '@capacitor-community/bluetooth-serial';
 *
 * export class CapacitorBluetoothAdapter implements PrintDriverAdapter {
 *   readonly name = 'capacitor-bluetooth';
 *
 *   async isAvailable(): Promise<boolean> {
 *     return 'Capacitor' in window;
 *   }
 *
 *   async isConnected(): Promise<boolean> {
 *     const { connected } = await BluetoothSerial.isConnected();
 *     return connected;
 *   }
 *
 *   async connect(): Promise<void> {
 *     const devices = await BluetoothSerial.list();
 *     const printer = devices.find(d => d.name?.includes('Printer'));
 *     if (printer) await BluetoothSerial.connect({ address: printer.address });
 *   }
 *
 *   async print(data: Uint8Array): Promise<PrintResult> {
 *     try {
 *       await BluetoothSerial.write({ data: Array.from(data) });
 *       return { success: true, driver: 'custom', timestamp: Date.now() };
 *     } catch (err) {
 *       return { success: false, driver: 'custom', error: String(err), timestamp: Date.now() };
 *     }
 *   }
 *
 *   async detect(): Promise<DetectedPrinter[]> {
 *     const devices = await BluetoothSerial.list();
 *     return devices.map(d => ({ driver: 'custom', name: d.name, connected: false }));
 *   }
 *
 *   async disconnect(): Promise<void> {
 *     await BluetoothSerial.disconnect();
 *   }
 * }
 * ```
 */
export interface PrintDriverAdapter {
  /** Unique name for this adapter (used in logs and detection) */
  readonly name: string;

  /** Priority in the fallback chain (lower = tried first). Default: 0 */
  readonly priority?: number;

  /** Returns true if this adapter's underlying API is available in the current environment. */
  isAvailable(): Promise<boolean>;

  /** Returns true if a printer is currently connected and ready to print. */
  isConnected(): Promise<boolean>;

  /** Opens a connection to the printer (may show a picker/dialog). */
  connect(): Promise<void>;

  /** Sends raw ESC/POS data to the printer. */
  print(data: Uint8Array): Promise<PrintResult>;

  /** Detects available printers without user interaction. */
  detect(): Promise<DetectedPrinter[]>;

  /** Closes the connection to the printer. */
  disconnect(): Promise<void>;
}
