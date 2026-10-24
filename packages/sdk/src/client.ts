import type { Receipt } from './receipt.js';

/**
 * Talk to POS Hardware Bridge running on this computer
 * (http://127.0.0.1:9191 by default) from a browser POS, Node or Electron.
 */

export interface BridgeClientOptions {
  /** Where the bridge listens. Default http://127.0.0.1:9191 */
  url?: string;
  /** The access token from the bridge's settings window ("Connect your POS"). */
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
    this.url = (options.url ?? 'http://127.0.0.1:9191').replace(/\/+$/, '');
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
      throw new BridgeError('POS Hardware Bridge is not running on this computer. Open it from the Start menu or the tray.', 0);
    }
    const data = (await res.json().catch(() => null)) as any;
    if (!res.ok) {
      const message =
        res.status === 401
          ? 'The bridge access token is wrong. Copy it again from the bridge settings.'
          : (data?.error && typeof data.error === 'string' ? data.error : data?.error?.message) ?? `The bridge answered ${res.status}.`;
      throw new BridgeError(message, res.status, Array.isArray(data?.details) ? data.details : []);
    }
    return data as T;
  }

  /** Is the bridge running, and are its printers ready? No token needed. */
  health(): Promise<{ ok: boolean; printerReady: boolean; printers: Array<{ id: string; kind: string; ready: boolean }> }> {
    return this.request('GET', '/health', undefined, false);
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
