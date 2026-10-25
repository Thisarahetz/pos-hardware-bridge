import type { Receipt } from './receipt.js';

/**
 * Talk to POS Hardware Bridge from a browser POS, Node or Electron: on this
 * computer (http://127.0.0.1:9191, the default), or from a phone, tablet or
 * till on the shop network after pairing (see BridgeClient.pair).
 */

const DEFAULT_URL = 'http://127.0.0.1:9191';

function isThisComputer(url: string): boolean {
  return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/i.test(url);
}

function unreachableMessage(url: string): string {
  return isThisComputer(url)
    ? 'POS Hardware Bridge is not running on this computer. Open it from the Start menu or the tray.'
    : `Can't reach the printer computer at ${url}. Check it is switched on, the bridge is running, and this device is on the same Wi-Fi.`;
}

async function readError(res: Response): Promise<{ message: string; details: string[] }> {
  const data = (await res.json().catch(() => null)) as any;
  const message =
    res.status === 401
      ? 'The bridge did not accept this device. Copy the access token again, or pair this device again.'
      : (typeof data?.error === 'string' ? data.error : data?.error?.message) ?? `The bridge answered ${res.status}.`;
  return { message, details: Array.isArray(data?.details) ? data.details : [] };
}

export interface PairOptions {
  /** The address shown in the bridge under "Shop network", e.g. http://192.168.1.20:9191 */
  url: string;
  /** The 6-digit code shown after clicking "Pair a device" in the bridge. */
  code: string;
  /** Shown in the bridge's device list, e.g. "Kitchen tablet". */
  name: string;
  timeoutMs?: number;
}

export interface PairResult {
  /** Save this: it is this device's own token for BridgeClient. Shown once. */
  token: string;
  deviceId: string;
  deviceName: string;
  bridge: { id: string; name: string; version: string };
  /** The address to use with BridgeClient. */
  url: string;
}

export interface HealthInfo {
  ok: boolean;
  bridge?: { id: string; name: string; version: string; acceptsDevices: boolean };
  printerReady: boolean;
  terminalReady?: boolean;
  printers: Array<{ id: string; kind: string; ready: boolean }>;
}

export interface BridgeClientOptions {
  /** Where the bridge listens. Default http://127.0.0.1:9191 (this computer).
   * From another device, the address shown under "Shop network" in the bridge. */
  url?: string;
  /** On the printer computer: the access token from "Connect your POS".
   * On another device: the token BridgeClient.pair() returned. */
  token: string;
  /** Milliseconds before a request gives up. Default 15000. */
  timeoutMs?: number;
}

export type StatusLevel = 'ok' | 'warning' | 'error' | 'off';

export interface DeviceStatus {
  level: StatusLevel;
  title: string;
  detail: string;
  /** What the cashier should do, in order. */
  steps: string[];
}

export interface PrinterInfo {
  /** API name to print to, e.g. "receipt", "kitchen", "invoice". */
  id: string;
  name: string;
  kind: 'receipt' | 'document';
  isDefault: boolean;
  ready: boolean;
  paperSize?: string;
  paperWidthChars?: number;
  status?: DeviceStatus;
}

export interface PrintOptions {
  /** Printer API name; default = the default receipt printer. */
  printer?: string;
  copies?: number;
  /** false: don't cut after this receipt. */
  cut?: boolean;
  /** Shown in the printer queue, e.g. "Bill #1042". */
  title?: string;
}

export interface PrintResult {
  ok: true;
  /** The printer that printed it. */
  printer: string;
}

export interface Preview {
  /** The receipt as it will print, as an SVG string. */
  svg: string;
  /** Characters per line it was laid out for. */
  cpl: number;
  printer: string | null;
}

/** A failed request. `message` is written for the cashier; `details` for developers. */
export class BridgeError extends Error {
  constructor(
    message: string,
    /** HTTP status; 0 when the bridge couldn't be reached at all. */
    readonly status: number,
    readonly details: string[] = [],
  ) {
    super(message);
    this.name = 'BridgeError';
  }

  /** The bridge isn't running (or the address is wrong). */
  get unreachable(): boolean {
    return this.status === 0;
  }
}

type Doc = string | Receipt;

export class BridgeClient {
  private readonly url: string;
  private readonly token: string;
  private readonly timeoutMs: number;

  constructor(options: BridgeClientOptions) {
    if (!options?.token) throw new Error('BridgeClient needs the access token from the bridge settings.');
    this.url = (options.url ?? DEFAULT_URL).replace(/\/+$/, '');
    this.token = options.token;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  private async request<T>(method: string, path: string, body?: unknown, auth = true): Promise<T> {
    let res: Response;
    try {
      res = await fetch(this.url + path, {
        method,
        headers: {
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(auth ? { Authorization: `Bearer ${this.token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new BridgeError(unreachableMessage(this.url), 0);
    }
    if (!res.ok) {
      const { message, details } = await readError(res);
      throw new BridgeError(message, res.status, details);
    }
    return (await res.json().catch(() => null)) as T;
  }

  /**
   * Pair a phone, tablet or till with the bridge on the printer computer.
   * Someone clicks "Pair a device" in the bridge and reads out the code; save
   * the returned token and url, then use `new BridgeClient({ url, token })`.
   */
  static async pair(options: PairOptions): Promise<PairResult> {
    const url = options.url.trim().replace(/\/+$/, '');
    let res: Response;
    try {
      res = await fetch(`${url}/pair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: String(options.code).replace(/\D/g, ''), name: options.name }),
        signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
      });
    } catch {
      throw new BridgeError(unreachableMessage(url), 0);
    }
    if (!res.ok) {
      const { message, details } = await readError(res);
      throw new BridgeError(res.status === 401 ? 'That code is wrong.' : message, res.status, details);
    }
    const data = (await res.json()) as Omit<PairResult, 'url'>;
    return { ...data, url };
  }

  /** Is the bridge running, and are its printers ready? No token needed. */
  health(): Promise<HealthInfo> {
    return this.request('GET', '/health', undefined, false);
  }

  /** Who the bridge thinks this is: the printer computer itself, or a paired device. */
  me(): Promise<{ kind: 'local' } | { kind: 'device'; deviceId: string; deviceName: string }> {
    return this.request('GET', '/me');
  }

  /** Every printer with its API name and live status. */
  printers(): Promise<PrinterInfo[]> {
    return this.request('GET', '/printers');
  }

  /** Plain-language status of every device, to show the cashier. */
  status(): Promise<{ printers: Array<DeviceStatus & { id: string; name: string }>; terminal: DeviceStatus }> {
    return this.request('GET', '/status');
  }

  /** Print a receipt (a Receipt from the builder, or ReceiptLine text). */
  print(receipt: Doc, options: PrintOptions = {}): Promise<PrintResult> {
    return this.request('POST', '/print/receiptline', { document: String(receipt), ...options });
  }

  /** The receipt as it will print on that printer, as an SVG for the screen. */
  preview(receipt: Doc, options: Pick<PrintOptions, 'printer'> = {}): Promise<Preview> {
    return this.request('POST', '/preview/receiptline', { document: String(receipt), ...options });
  }

  /** Print an A4/A5 page (an invoice) from HTML, or a PDF (base64, macOS/Linux). */
  printDocument(
    page: { html: string } | { pdfBase64: string },
    options: { printer?: string; paperSize?: 'A4' | 'A5' | 'Letter' | 'Legal'; landscape?: boolean; copies?: number; title?: string } = {},
  ): Promise<PrintResult> {
    return this.request('POST', '/print/document', { ...page, ...options });
  }

  /**
   * Print a ready-made HTML bill on any printer. A thermal printer prints it
   * as an image at its print-head width; prefer print() with a receipt for
   * sharper, smaller receipts.
   */
  printPage(
    html: string,
    options: { printer?: string; format?: '80mm' | '58mm' | 'a4' | 'a5'; copies?: number; title?: string } = {},
  ): Promise<PrintResult> {
    return this.request('POST', '/print/page', { html, ...options });
  }

  /** Print the bridge's test page on a printer. */
  printTestPage(printer?: string): Promise<PrintResult> {
    return this.request('POST', '/print/test', printer ? { printer } : {});
  }

  /**
   * Live status updates (printer unplugged, back online…). Returns a function
   * that stops listening. Uses the browser/Node 22+ WebSocket.
   */
  onStatus(listener: (status: unknown) => void): () => void {
    const ws = new WebSocket(`${this.url.replace(/^http/, 'ws')}/events?token=${encodeURIComponent(this.token)}`);
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(String(event.data));
        if (msg?.event === 'bridge.status') listener(msg.payload);
      } catch {
        // ignore malformed messages
      }
    };
    return () => ws.close();
  }
}
