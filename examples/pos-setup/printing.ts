// printing.ts: one place for everything your POS knows about printing.
import { BridgeClient, BridgeError, ReceiptBuilder } from 'pos-hardware-bridge';
import type { PrinterInfo, ReceiptDocument } from 'pos-hardware-bridge';

/** What each kind of print is for. Add your own roles here. */
export type PrintRole = 'receipt' | 'kitchen' | 'invoice';

export interface PrintSettings {
  /** http://127.0.0.1:9191 on the printer computer, the shop address on a tablet. */
  url: string;
  /** Access token (printer computer) or device token (from pairing). */
  token: string;
  /** Printer API name per role. '' = the bridge's default; null = don't print. */
  printers: Record<PrintRole, string | null>;
  /** Print the customer receipt as soon as a sale is saved. */
  autoPrint: boolean;
  copies: number;
}

const STORAGE_KEY = 'pos.printing';

export const DEFAULT_SETTINGS: PrintSettings = {
  url: 'http://127.0.0.1:9191',
  token: '',
  printers: { receipt: '', kitchen: null, invoice: '' },
  autoPrint: true,
  copies: 1,
};

// ---- Saved settings (per device, never in your code or database) ----

export function loadSettings(): PrintSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    return saved
      ? { ...DEFAULT_SETTINGS, ...saved, printers: { ...DEFAULT_SETTINGS.printers, ...saved.printers } }
      : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: PrintSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function isConfigured(settings = loadSettings()): boolean {
  return settings.token !== '';
}

function clientFor(settings: PrintSettings): BridgeClient {
  return new BridgeClient({ url: settings.url, token: settings.token });
}

// ---- Connecting ----

export interface Connection {
  bridgeName: string;
  version: string;
  /** 'local' = this is the printer computer; 'device' = a paired tablet or till. */
  kind: 'local' | 'device';
  printers: PrinterInfo[];
}

/**
 * Check the address and token work, and load the printer list.
 * Throws BridgeError with a message you can show as it is.
 */
export async function testConnection(url: string, token: string): Promise<Connection> {
  const bridge = new BridgeClient({ url, token, timeoutMs: 5000 });
  const health = await bridge.health(); // no token: is it running?
  const me = await bridge.me(); // token: is it accepted?
  const printers = await bridge.printers();
  return {
    bridgeName: health.bridge?.name ?? 'POS Hardware Bridge',
    version: health.bridge?.version ?? '',
    kind: me.kind,
    printers,
  };
}

/** A tablet or till: trade the 6-digit code for this device's own token. */
export async function pairThisDevice(url: string, code: string, deviceName: string) {
  const paired = await BridgeClient.pair({ url, code, name: deviceName });
  return { url: paired.url, token: paired.token };
}

// ---- Printing ----

export type PrintOutcome =
  | { ok: true; printer: string }
  | { ok: false; skipped: true }
  | { ok: false; skipped?: false; message: string; canRetry: boolean };

/**
 * Print to the printer chosen for this role. Never throws: a printer problem
 * must not break a sale. Show `message` and a Reprint button when !ok.
 */
export async function printFor(
  role: PrintRole,
  receipt: ReceiptBuilder | ReceiptDocument,
  options: { title?: string; copies?: number } = {},
): Promise<PrintOutcome> {
  const settings = loadSettings();
  const printer = settings.printers[role];
  if (!isConfigured(settings) || printer === null) return { ok: false, skipped: true };
  try {
    const result = await clientFor(settings).printReceipt(receipt, {
      printer: printer || undefined,
      copies: options.copies ?? settings.copies,
      title: options.title,
    });
    return { ok: true, printer: result.printer };
  } catch (error) {
    if (error instanceof BridgeError) {
      // 0 = no answer: it may or may not have printed, so ask before reprinting.
      return { ok: false, message: error.message, canRetry: error.status !== 0 };
    }
    return { ok: false, message: 'Printing failed.', canRetry: true };
  }
}

/** A4 invoice from HTML, to the printer chosen for 'invoice'. */
export async function printInvoice(html: string, title?: string): Promise<PrintOutcome> {
  const settings = loadSettings();
  const printer = settings.printers.invoice;
  if (!isConfigured(settings) || printer === null) return { ok: false, skipped: true };
  try {
    const result = await clientFor(settings).printDocument({ html }, { printer: printer || undefined, title });
    return { ok: true, printer: result.printer };
  } catch (error) {
    const message = error instanceof BridgeError ? error.message : 'Printing failed.';
    return { ok: false, message, canRetry: !(error instanceof BridgeError && error.status === 0) };
  }
}

export async function printTestPage(role: PrintRole): Promise<PrintOutcome> {
  const settings = loadSettings();
  const printer = settings.printers[role];
  if (printer === null) return { ok: false, skipped: true };
  try {
    const result = await clientFor(settings).printTestPage(printer || undefined);
    return { ok: true, printer: result.printer };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Printing failed.', canRetry: true };
  }
}

// ---- Live status for the POS header ----

export type PrinterLight = 'ok' | 'warning' | 'error' | 'off';

export interface PrinterStatusSummary {
  light: PrinterLight;
  /** One line for the cashier, e.g. "Front counter: out of paper". */
  text: string;
}

function summarize(status: { printers: Array<{ level: PrinterLight; title: string; name: string }> }): PrinterStatusSummary {
  const worst =
    status.printers.find((p) => p.level === 'error') ??
    status.printers.find((p) => p.level === 'warning') ??
    status.printers.find((p) => p.level === 'off');
  if (status.printers.length === 0) return { light: 'warning', text: 'No printers set up in the bridge' };
  return worst ? { light: worst.level, text: `${worst.name}: ${worst.title}` } : { light: 'ok', text: 'Printers ready' };
}

/**
 * Calls `onChange` now and whenever a printer's status changes. Also checks
 * every 10 s, so it recovers when the bridge restarts. Returns a function
 * that stops watching.
 */
export function watchPrinterStatus(onChange: (summary: PrinterStatusSummary) => void): () => void {
  const settings = loadSettings();
  if (!isConfigured(settings)) {
    onChange({ light: 'off', text: 'Printing not set up' });
    return () => {};
  }
  const bridge = clientFor(settings);
  let stopped = false;
  let stopListening = () => {};
  let retry: ReturnType<typeof setTimeout> | undefined;

  const connect = async () => {
    try {
      onChange(summarize(await bridge.status()));
      stopListening = bridge.onStatus((payload) => onChange(summarize(payload as any)));
    } catch (error) {
      onChange({ light: 'error', text: error instanceof BridgeError ? error.message : 'Bridge not reachable' });
    }
  };
  // Poll every 10 s as a safety net: covers a dropped socket or a bridge restart.
  const poll = async () => {
    if (stopped) return;
    try {
      onChange(summarize(await bridge.status()));
    } catch (error) {
      onChange({ light: 'error', text: error instanceof BridgeError ? error.message : 'Bridge not reachable' });
    }
    retry = setTimeout(poll, 10_000);
  };

  void connect().then(() => (retry = setTimeout(poll, 10_000)));
  return () => {
    stopped = true;
    clearTimeout(retry);
    stopListening();
  };
}
