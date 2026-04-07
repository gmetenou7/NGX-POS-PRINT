import { Injectable, inject } from '@angular/core';
import type { DetectedPrinter, PrintResult } from '../models/print.models';
import { POS_PRINT_CONFIG } from '../providers/pos-print.providers';

/** Default WebSocket connection timeout in ms */
const DEFAULT_TIMEOUT = 3000;
/** Timeout for ping/detection check in ms */
const PING_TIMEOUT = 1500;

/**
 * Print driver using WebSocket to communicate with a network-connected POS printer.
 * Requires the printer (or a relay) to accept WebSocket connections.
 */
@Injectable({ providedIn: 'root' })
export class NetworkPrintService {
  private readonly config = inject(POS_PRINT_CONFIG, { optional: true }) ?? {};

  /**
   * Checks if WebSocket API is available in the current environment.
   */
  isAvailable(): boolean {
    return typeof WebSocket !== 'undefined';
  }

  /**
   * Checks if a network printer is reachable at the configured IP.
   * Attempts a quick WebSocket handshake to verify connectivity.
   * @param ip - Printer IP (falls back to config.networkIp)
   * @param port - Printer port (falls back to config.networkPort, then 9100)
   */
  async isConnected(ip?: string, port?: number): Promise<boolean> {
    const targetIp = ip ?? this.config.networkIp;
    if (!targetIp || !this.isAvailable()) return false;
    const targetPort = port ?? this.config.networkPort ?? 9100;

    return new Promise<boolean>((resolve) => {
      try {
        const ws = new WebSocket(`ws://${targetIp}:${targetPort}`);
        const timer = setTimeout(() => {
          ws.close();
          resolve(false);
        }, PING_TIMEOUT);

        ws.onopen = () => {
          clearTimeout(timer);
          ws.close();
          resolve(true);
        };

        ws.onerror = () => {
          clearTimeout(timer);
          resolve(false);
        };
      } catch {
        resolve(false);
      }
    });
  }

  /**
   * Detects the network printer if configured and reachable.
   */
  async detect(): Promise<DetectedPrinter[]> {
    const ip = this.config.networkIp;
    if (!ip) return [];
    const port = this.config.networkPort ?? 9100;
    const connected = await this.isConnected(ip, port);
    if (!connected) return [];
    return [{
      driver: 'network',
      name: `Network Printer (${ip}:${port})`,
      connected: true,
    }];
  }

  /**
   * Sends ESC/POS data to a printer over WebSocket.
   * @param data - ESC/POS command byte array
   * @param ip - Printer IP address or hostname
   * @param port - Printer port (default 9100)
   * @param timeout - Connection timeout in ms (default 3000)
   * @returns Print result indicating success or failure
   */
  async print(
    data: Uint8Array,
    ip?: string,
    port?: number,
    timeout = DEFAULT_TIMEOUT
  ): Promise<PrintResult> {
    const targetIp = ip ?? this.config.networkIp;
    if (!targetIp) {
      return {
        success: false,
        driver: 'network',
        error: 'Network driver requires an IP address (networkIp in config or ip parameter).',
        timestamp: Date.now(),
      };
    }
    const targetPort = port ?? this.config.networkPort ?? 9100;

    return new Promise<PrintResult>((resolve) => {
      try {
        const url = `ws://${targetIp}:${targetPort}`;
        const ws = new WebSocket(url);
        ws.binaryType = 'arraybuffer';

        const timer = setTimeout(() => {
          ws.close();
          resolve({
            success: false,
            driver: 'network',
            error: `Connection to ${targetIp}:${targetPort} timed out after ${timeout}ms.`,
            timestamp: Date.now(),
          });
        }, timeout);

        ws.onopen = () => {
          ws.send(data.buffer);
          clearTimeout(timer);
          ws.close();
          resolve({ success: true, driver: 'network', timestamp: Date.now() });
        };

        ws.onerror = () => {
          clearTimeout(timer);
          resolve({
            success: false,
            driver: 'network',
            error: `WebSocket error connecting to ${targetIp}:${targetPort}`,
            timestamp: Date.now(),
          });
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown network error';
        resolve({ success: false, driver: 'network', error: message, timestamp: Date.now() });
      }
    });
  }
}
