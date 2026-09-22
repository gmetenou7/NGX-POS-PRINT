import { Injectable, inject } from '@angular/core';
import type {
  DetectedPrinter,
  DocumentPrintOptions,
  DocumentPrintResult,
  HostPrinter,
  PrinterCapabilities,
  PrintResult,
} from '../models/print.models';
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

/**
 * Per-request timeouts, ms.
 *
 * A fetch with no timeout never gives up. The agent talks to real hardware, and hardware goes
 * quiet: an unplugged printer whose queue is still declared keeps its driver waiting, and a
 * caller that waits with it shows a spinner that never stops. Every call is therefore bounded,
 * and a bounded failure is one a page can report.
 */
const LIST_TIMEOUT = 8_000;
const CAPABILITIES_TIMEOUT = 20_000;
const PRINT_TIMEOUT = 120_000;
/** sessionStorage key for the cached working base URL. */
const CACHE_KEY = 'ngx-pos-print:bridge-base';

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
      const body = (await r.json()) as { printers?: HostPrinter[] };
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
   * Lists **every** printer the host can reach, not only thermal ones.
   *
   * `detect()` deliberately keeps only thermal printers, because it feeds the ESC/POS routing.
   * This one keeps everything, because that is the list a print window has to show: office A4,
   * dot matrix and receipt printers alike.
   */
  async listPrinters(): Promise<HostPrinter[]> {
    const base = await this.resolveBase();
    if (!base) return [];
    try {
      const r = await this.fetchWithTimeout(`${base}/printers`, LIST_TIMEOUT);
      if (!r.ok) return [];
      const body = (await r.json()) as { printers?: HostPrinter[] };
      return body.printers ?? [];
    } catch {
      return [];
    }
  }

  /**
   * Reads what a printer's driver says it can do: papers, trays, duplex, color, copies.
   *
   * Same source as the system's own settings window. An app can therefore offer exactly the
   * options the machine honours, instead of offering some it will silently replace.
   *
   * Returns null for a printer with no host driver to query, a receipt printer on raw USB for
   * instance: it has no options to offer, and that is an answer rather than a failure.
   */
  async capabilities(printerId: string): Promise<PrinterCapabilities | null> {
    const base = await this.resolveBase();
    if (!base) return null;
    try {
      const r = await this.fetchWithTimeout(
        `${base}/printers/${encodeURIComponent(printerId)}/capabilities`, CAPABILITIES_TIMEOUT);
      if (!r.ok) return null;
      const body = (await r.json()) as { ok?: boolean; driverless?: boolean; capabilities?: PrinterCapabilities };
      if (!body.ok || body.driverless || !body.capabilities) return null;
      return body.capabilities;
    } catch {
      return null;
    }
  }

  /**
   * Prints a page document: an invoice, a delivery note, anything meant for a sheet of paper.
   *
   * Pages are sent **already rendered**, one image each. Whoever prints usually shows a preview
   * first, so that rendering already exists on their side; doing it again in the agent would
   * mean embedding a PDF engine in it, and losing the single self-contained executable.
   *
   * No dialog opens. The options travel in the driver's own settings structure, which is the
   * whole point of the agent.
   *
   * @param pages one image per page, base64 or a `data:` URL straight from a canvas
   */
  async printDocument(pages: string[], options: DocumentPrintOptions = {}): Promise<DocumentPrintResult> {
    const t0 = Date.now();
    const base = await this.resolveBase();
    if (!base) {
      return {
        success: false,
        pages: 0,
        error: 'Print Bridge agent unreachable. Is it installed and running?',
        timestamp: t0,
      };
    }
    if (pages.length === 0) {
      return { success: false, pages: 0, error: 'No page to print.', timestamp: t0 };
    }

    try {
      const { printerId, jobName, ...rest } = options;
      const r = await this.fetchWithTimeout(`${base}/print-document`, PRINT_TIMEOUT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ printerId, jobName, pages, options: rest }),
      });
      const json = (await r.json().catch(() => ({}))) as { ok?: boolean; pages?: number; error?: string };
      if (!r.ok || json.ok === false) {
        return { success: false, pages: json.pages ?? 0, error: json.error ?? `HTTP ${r.status}`, timestamp: t0 };
      }
      return { success: true, pages: json.pages ?? pages.length, timestamp: t0 };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, pages: 0, error: message, timestamp: t0 };
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

  /** A fetch that gives up, so a silent agent cannot hold a caller forever. */
  private async fetchWithTimeout(url: string, timeout: number, init?: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

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
