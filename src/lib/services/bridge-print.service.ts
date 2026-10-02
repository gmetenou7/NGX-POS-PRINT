import { Injectable, inject } from '@angular/core';
import type {
  BridgeErrorCode,
  BridgePairingStatus,
  BridgePairResult,
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
/** Header that carries the pairing token. */
const TOKEN_HEADER = 'X-Print-Bridge-Token';
const UNREACHABLE = 'Print Bridge agent unreachable. Is it installed and running?';

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
 *
 * <h4>Pairing (agent 1.1 and later)</h4>
 *
 * The agent only serves web origins on its allow list, and only to a page that paired: the page
 * generates a random token, registers it once with `pairBridge(token)`, and every later call
 * carries it in `X-Print-Bridge-Token`. A call the agent refuses for lack of a known token
 * fails with `errorCode: 'pairing_required'`, distinct from `agent_unreachable`.
 *
 * The header is only sent to an agent whose `/health` announces `pairingRequired`: an older
 * agent does not list it among its allowed CORS headers and the browser would block every call.
 */
@Injectable({ providedIn: 'root' })
export class BridgePrintService {
  private readonly config = inject(POS_PRINT_CONFIG, { optional: true }) ?? {};
  private cachedBase: string | null = null;
  private token: string | null = this.config.bridgeToken || null;
  /** What the agent's /health said: true when it wants a token, false for an older agent. */
  private pairingRequired: boolean | null = null;
  /** Why the last call failed, when the agent said so; null after a success. */
  private lastErrorCode: BridgeErrorCode | null = null;

  /** Sets (or clears) the pairing token sent on every agent call. */
  setBridgeToken(token: string | null): void {
    this.token = token || null;
  }

  /** The pairing token in use, or null. */
  getBridgeToken(): string | null {
    return this.token;
  }

  /**
   * Why the last list / capabilities / print call failed, when it can be told:
   * `pairing_required`, `origin_not_allowed` or `agent_unreachable`. Null after a success.
   *
   * `listPrinters()` and `capabilities()` keep returning an empty answer on failure, as before;
   * this tells a caller whether to offer "pair again" or "install the agent".
   */
  get lastError(): BridgeErrorCode | null {
    return this.lastErrorCode;
  }

  /**
   * Registers a token with the agent, then uses it for every call.
   *
   * The agent accepts it only from a web origin on its allow list; it keeps a hash of it, and
   * several tokens may be paired at once (one per browser profile). Pairing an already paired
   * token is harmless.
   *
   * @param token 32 to 512 printable characters, random; defaults to the current token
   */
  async pairBridge(token: string | null = this.token): Promise<BridgePairResult> {
    if (!token) return { success: false, error: 'No token to pair.' };
    const base = await this.resolveBase();
    if (!base) return this.pairFailure('agent_unreachable', UNREACHABLE);
    try {
      const r = await this.fetchWithTimeout(`${base}/pair`, LIST_TIMEOUT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const json = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!r.ok || json.ok === false) {
        const code = this.codeOf(r.status, json.error);
        return { success: false, errorCode: code ?? undefined, error: json.error ?? `HTTP ${r.status}` };
      }
      this.token = token;
      this.pairingRequired = true;
      this.lastErrorCode = null;
      return { success: true };
    } catch (err) {
      return this.pairFailure('agent_unreachable', err instanceof Error ? err.message : String(err));
    }
  }

  /** Removes the current token from the agent. The token stays set locally until `setBridgeToken(null)`. */
  async unpairBridge(): Promise<BridgePairResult> {
    if (!this.token) return { success: false, error: 'No token to unpair.' };
    const base = await this.resolveBase();
    if (!base) return this.pairFailure('agent_unreachable', UNREACHABLE);
    try {
      const r = await this.fetchWithTimeout(`${base}/pair`, LIST_TIMEOUT, {
        method: 'DELETE',
        headers: { [TOKEN_HEADER]: this.token },
      });
      const json = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!r.ok || json.ok === false) {
        const code = this.codeOf(r.status, json.error);
        return { success: false, errorCode: code ?? undefined, error: json.error ?? `HTTP ${r.status}` };
      }
      return { success: true };
    } catch (err) {
      return this.pairFailure('agent_unreachable', err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * Tells whether this page can use the agent: absent, older agent (no pairing), paired, or not.
   */
  async pairingStatus(): Promise<BridgePairingStatus> {
    const base = await this.resolveBase();
    if (!base) return 'absent';
    if (this.pairingRequired === null) await this.ping(base);
    if (this.pairingRequired === false) return 'legacy';
    if (!this.token) return 'unpaired';
    try {
      const r = await this.fetchWithTimeout(`${base}/health`, LIST_TIMEOUT, { headers: this.authHeaders() });
      if (!r.ok) return 'absent';
      const body = (await r.json()) as { pairingRequired?: boolean; paired?: boolean };
      if (!body.pairingRequired) {
        this.pairingRequired = false;
        return 'legacy';
      }
      return body.paired ? 'paired' : 'unpaired';
    } catch {
      return 'absent';
    }
  }

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
      const r = await fetch(`${base}/printers`, { headers: this.authHeaders() });
      if (!this.track(r)) return [];
      const body = (await r.json()) as { printers?: HostPrinter[] };
      const printers = body.printers ?? [];
      return printers
        .filter(p => p.isThermal)
        .map(p => ({
          driver: 'bridge' as const,
          name: `${p.name} [${p.channel}]${p.isDefault ? ' ★' : ''}`,
          connected: p.status === 'ready',
        }));
    } catch (err) {
      this.lost(err);
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
      const r = await this.fetchWithTimeout(`${base}/printers`, LIST_TIMEOUT, { headers: this.authHeaders() });
      if (!this.track(r)) return [];
      const body = (await r.json()) as { printers?: HostPrinter[] };
      return body.printers ?? [];
    } catch (err) {
      this.lost(err);
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
        `${base}/printers/${encodeURIComponent(printerId)}/capabilities`, CAPABILITIES_TIMEOUT,
        { headers: this.authHeaders() });
      if (!this.track(r)) return null;
      const body = (await r.json()) as { ok?: boolean; driverless?: boolean; capabilities?: PrinterCapabilities };
      if (!body.ok || body.driverless || !body.capabilities) return null;
      return body.capabilities;
    } catch (err) {
      this.lost(err);
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
      return { success: false, pages: 0, error: UNREACHABLE, errorCode: 'agent_unreachable', timestamp: t0 };
    }
    if (pages.length === 0) {
      return { success: false, pages: 0, error: 'No page to print.', timestamp: t0 };
    }

    try {
      const { printerId, jobName, ...rest } = options;
      const r = await this.fetchWithTimeout(`${base}/print-document`, PRINT_TIMEOUT, {
        method: 'POST',
        headers: this.authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ printerId, jobName, pages, options: rest }),
      });
      const json = (await r.json().catch(() => ({}))) as { ok?: boolean; pages?: number; error?: string };
      const errorCode = this.trackCode(r.status, json.error);
      if (!r.ok || json.ok === false) {
        return {
          success: false,
          pages: json.pages ?? 0,
          error: json.error ?? `HTTP ${r.status}`,
          ...(errorCode ? { errorCode } : {}),
          timestamp: t0,
        };
      }
      return { success: true, pages: json.pages ?? pages.length, timestamp: t0 };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const errorCode = this.lost(err);
      return { success: false, pages: 0, error: message, ...(errorCode ? { errorCode } : {}), timestamp: t0 };
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
      return { success: false, driver: 'bridge', error: UNREACHABLE, errorCode: 'agent_unreachable', timestamp: t0 };
    }
    try {
      const body = {
        raw: this.toBase64(data),
        printerId: this.config.bridgePrinterId,
      };
      const r = await fetch(`${base}/print`, {
        method: 'POST',
        headers: this.authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
      });
      const json = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      const errorCode = this.trackCode(r.status, json.error);
      if (!r.ok || json.ok === false) {
        return {
          success: false,
          driver: 'bridge',
          error: json.error ?? `HTTP ${r.status}`,
          ...(errorCode ? { errorCode } : {}),
          timestamp: t0,
        };
      }
      return { success: true, driver: 'bridge', timestamp: t0 };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const errorCode = this.lost(err);
      return { success: false, driver: 'bridge', error: message, ...(errorCode ? { errorCode } : {}), timestamp: t0 };
    }
  }

  // --- internals -----------------------------------------------------------

  /**
   * Headers for an agent call: the token joins them only for an agent that asks for it, an
   * older one would refuse the unknown header at preflight and the browser would block the call.
   */
  private authHeaders(extra: Record<string, string> = {}): Record<string, string> {
    if (this.token && this.pairingRequired !== false) return { ...extra, [TOKEN_HEADER]: this.token };
    return extra;
  }

  /** Maps an agent refusal to its typed reason. */
  private codeOf(status: number, error?: string): BridgeErrorCode | null {
    if (error === 'pairing_required' || (status === 401 && !error)) return 'pairing_required';
    if (error === 'origin_not_allowed') return 'origin_not_allowed';
    return null;
  }

  /** Records the reason of a failed call; a pairing refusal also proves the agent wants a token. */
  private trackCode(status: number, error?: string): BridgeErrorCode | null {
    const code = this.codeOf(status, error);
    if (code === 'pairing_required') this.pairingRequired = true;
    this.lastErrorCode = code;
    return code;
  }

  /** True for a successful response; otherwise records why, reading the agent's error. */
  private track(r: Response): boolean {
    if (r.ok) {
      this.lastErrorCode = null;
      return true;
    }
    this.trackCode(r.status, r.status === 401 ? 'pairing_required' : r.status === 403 ? 'origin_not_allowed' : undefined);
    return false;
  }

  /**
   * A fetch that throws a TypeError never reached the agent: it stopped, or moved to its other
   * port. The cached address is forgotten so the next call probes again. A timeout is not that.
   */
  private lost(err: unknown): BridgeErrorCode | null {
    if (!(err instanceof TypeError)) return null;
    this.cachedBase = null;
    this.pairingRequired = null;
    this.writeCache(null);
    this.lastErrorCode = 'agent_unreachable';
    return 'agent_unreachable';
  }

  private pairFailure(errorCode: BridgeErrorCode, error: string): BridgePairResult {
    this.lastErrorCode = errorCode;
    return { success: false, errorCode, error };
  }

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
      // Learn whether this agent wants a token; an unreachable one is told apart later.
      await this.ping(this.cachedBase);
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
    this.lastErrorCode = 'agent_unreachable';
    return null;
  }

  private async ping(base: string): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT);
      const r = await fetch(`${base}/health`, { signal: controller.signal });
      clearTimeout(timer);
      if (r.ok) {
        const body = (await r.json().catch(() => ({}))) as { pairingRequired?: boolean };
        this.pairingRequired = body.pairingRequired === true;
      }
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
