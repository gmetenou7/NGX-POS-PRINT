import { Injectable, inject } from '@angular/core';
import type { DetectedPrinter, PrintResult } from '../models/print.models';
import { POS_PRINT_CONFIG } from '../providers/pos-print.providers';

/** Ports the bridge driver probes when no base URL is set. */
const PROBE_BASES = [
  'https://localhost:19101',
  'http://127.0.0.1:19100',
  'https://localhost:19103',
  'http://127.0.0.1:19102',
];

/** Quick liveness probe timeout, ms. */
const PROBE_TIMEOUT = 600;
/** sessionStorage key for the cached working base URL. */
const CACHE_KEY = 'ngx-pos-print:bridge-base';

interface BridgePrinter {
  id: string;
  name: string;
  channel: string;
  isThermal: boolean;
  isDefault: boolean;
  status: 'ready' | 'printing' | 'offline' | 'error' | 'paused' | 'unknown';
}

/**
 * Print driver that delegates to a local Print Bridge agent
 * (https://github.com/gmetenou7/POS-PRINTER-DRIVER-FOR-NGX-POS-PRINT-IN-WINDOWS).
 *
 * The agent runs as a Windows service and exposes an HTTP+HTTPS API on
 * localhost. It detects every thermal printer the host can reach
 * (winspool / WinUSB / network / serial / Bluetooth) and accepts raw
 * ESC/POS bytes, so this driver inherits multi-channel routing without
 * any browser-side device permissions or USB drivers.
 *
 * The bridge agent must be installed and running on the user's machine.
 */
@Injectable({ providedIn: 'root' })
export class BridgePrintService {
  private readonly config = inject(POS_PRINT_CONFIG, { optional: true }) ?? {};
  private cachedBase: string | null = null;

  /** True in any environment that can issue fetch() against localhost. */
  isAvailable(): boolean {
    return typeof fetch !== 'undefined';
  }

  /** Resolves true when an agent answers /health within the probe timeout. */
  async isConnected(): Promise<boolean> {
    const base = await this.resolveBase();
    return base !== null;
  }

  /** Lists thermal printers reported by the agent. Empty if agent unreachable. */
  async detect(): Promise<DetectedPrinter[]> {
    const base = await this.resolveBase();
    if (!base) return [];
    try {
      const r = await fetch(`${base}/printers`);
      if (!r.ok) return [];
      const body = (await r.json()) as { printers?: BridgePrinter[] };
      const printers = body.printers ?? [];
      return printers
        .filter(p => p.isThermal)
        .map(p => ({
          driver: 'bridge' as const,
          name: `${p.name} [${p.channel}]${p.isDefault ? ' ★' : ''}`,
          connected: p.status === 'ready',
        }));
    } catch {
      return [];
    }
  }

  /**
   * Sends raw ESC/POS bytes to the agent. The agent picks the routing
   * (winspool RAW, libusb bulk-out, TCP 9100, serial) based on the
   * target printer's channel.
   */
  async print(data: Uint8Array): Promise<PrintResult> {
    const t0 = Date.now();
    const base = await this.resolveBase();
    if (!base) {
      return {
        success: false,
        driver: 'bridge',
        error: 'Print Bridge agent unreachable. Is it installed and running?',
        timestamp: t0,
      };
    }
    try {
      const body = {
        raw: this.toBase64(data),
        printerId: this.config.bridgePrinterId,
      };
      const r = await fetch(`${base}/print`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!r.ok || json.ok === false) {
        return {
          success: false,
          driver: 'bridge',
          error: json.error ?? `HTTP ${r.status}`,
          timestamp: t0,
        };
      }
      return { success: true, driver: 'bridge', timestamp: t0 };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, driver: 'bridge', error: message, timestamp: t0 };
    }
  }

  // --- internals -----------------------------------------------------------

  /**
   * Returns the first base URL that answers /health, or null.
   *
   * Resolution order:
   *   1. `config.bridgeBaseUrl` if set
   *   2. cached value in sessionStorage
   *   3. probe PROBE_BASES sequentially
   */
  private async resolveBase(): Promise<string | null> {
    if (this.cachedBase) return this.cachedBase;
    if (this.config.bridgeBaseUrl) {
      this.cachedBase = this.stripTrailingSlash(this.config.bridgeBaseUrl);
      return this.cachedBase;
    }
    const cached = this.readCache();
    if (cached && (await this.ping(cached))) {
      this.cachedBase = cached;
      return cached;
    }
    if (cached) this.writeCache(null);
    for (const candidate of PROBE_BASES) {
      if (await this.ping(candidate)) {
        this.cachedBase = candidate;
        this.writeCache(candidate);
        return candidate;
      }
    }
    return null;
  }

  private async ping(base: string): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT);
      const r = await fetch(`${base}/health`, { signal: controller.signal });
      clearTimeout(timer);
      return r.ok;
    } catch {
      return false;
    }
  }

  private readCache(): string | null {
    try {
      return sessionStorage.getItem(CACHE_KEY);
    } catch {
      return null;
    }
  }

  private writeCache(value: string | null): void {
    try {
      if (value) sessionStorage.setItem(CACHE_KEY, value);
      else sessionStorage.removeItem(CACHE_KEY);
    } catch {
      // sessionStorage not available (SSR)
    }
  }

  private stripTrailingSlash(s: string): string {
    return s.replace(/\/+$/, '');
  }

  private toBase64(bytes: Uint8Array): string {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
}
