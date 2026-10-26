import { BridgeClient, BridgeError } from './client.js';
import type { PrinterInfo, StatusLevel } from './client.js';
import type { ReceiptDocument } from './layout.js';
import type { ReceiptBuilder } from './lines.js';

/**
 * Everything a POS needs to know about printing, with no UI: the device's
 * saved printer settings, connecting and pairing, printing per role
 * (receipt, kitchen, invoice…) and a live status summary for the header.
 * The React widget in `pos-hardware-bridge/react` is built on these.
 */

export const THIS_COMPUTER_URL = 'http://127.0.0.1:9191';
export const DEFAULT_STORAGE_KEY = 'pos-hardware-bridge.settings';
const CHANGE_EVENT = 'pos-hardware-bridge:settings';

/** A kind of print your POS makes. Add your own, e.g. "bar" or "label". */
export interface PrintRoleConfig {
  /** Stable id you print with: printFor('kitchen', …). */
  id: string;
  /** Shown in the settings, e.g. "Kitchen tickets". */
  label: string;
  /** Which printers fit: thermal 'receipt' printers or A4 'document' printers. */
  kind: PrinterInfo['kind'];
  /** Before the shop chooses: '' = the bridge's default printer, null = don't print. */
  defaultPrinter?: '' | null;
}

export const DEFAULT_ROLES: PrintRoleConfig[] = [
  { id: 'receipt', label: 'Customer receipts', kind: 'receipt', defaultPrinter: '' },
  { id: 'kitchen', label: 'Kitchen tickets', kind: 'receipt', defaultPrinter: null },
  { id: 'invoice', label: 'A4 invoices', kind: 'document', defaultPrinter: '' },
];

export interface PrintSettings {
  /** http://127.0.0.1:9191 on the printer computer, the shop address on a tablet. */
  url: string;
  /** Access token (printer computer) or device token (from pairing). '' = not set up. */
  token: string;
  /** Printer API name per role id. '' = the bridge's default printer; null = don't print. */
  printers: Record<string, string | null>;
  /** Print the customer receipt as soon as a sale is saved. */
  autoPrint: boolean;
  /** 1–5. */
  copies: number;
}

export interface StorageOptions {
  /** localStorage key. Change it to keep several settings apart. */
  storageKey?: string;
  /** Roles, for their default printers. Default DEFAULT_ROLES. */
  roles?: PrintRoleConfig[];
}

export function defaultPrintSettings(roles: PrintRoleConfig[] = DEFAULT_ROLES): PrintSettings {
  return {
    url: THIS_COMPUTER_URL,
    token: '',
    printers: Object.fromEntries(roles.map((r) => [r.id, r.defaultPrinter === undefined ? '' : r.defaultPrinter])),
    autoPrint: true,
    copies: 1,
  };
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // blocked (private mode, sandboxed iframe)
  }
}

/** This device's saved settings, or the defaults. Safe during server rendering. */
export function loadPrintSettings(options: StorageOptions = {}): PrintSettings {
  const defaults = defaultPrintSettings(options.roles);
  try {
    const saved = JSON.parse(storage()?.getItem(options.storageKey ?? DEFAULT_STORAGE_KEY) ?? 'null');
    if (!saved || typeof saved !== 'object') return defaults;
    return { ...defaults, ...saved, printers: { ...defaults.printers, ...saved.printers } };
  } catch {
    return defaults;
  }
}

/** Save this device's settings. Open widgets and status badges update. */
export function savePrintSettings(settings: PrintSettings, options: StorageOptions = {}): void {
  const key = options.storageKey ?? DEFAULT_STORAGE_KEY;
  try {
    storage()?.setItem(key, JSON.stringify(settings));
  } catch {
    // storage full or blocked: settings last until the page reloads
  }
  if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { key } }));
  }
}

/** Calls `listener` when the settings change, in this tab or another. Returns stop(). */
export function onPrintSettingsChange(listener: () => void, options: StorageOptions = {}): () => void {
  if (typeof window === 'undefined') return () => {};
  const key = options.storageKey ?? DEFAULT_STORAGE_KEY;
  const local = (e: Event) => (e as CustomEvent).detail?.key === key && listener();
  const other = (e: StorageEvent) => e.key === key && listener();
  window.addEventListener(CHANGE_EVENT, local);
  window.addEventListener('storage', other);
  return () => {
    window.removeEventListener(CHANGE_EVENT, local);
    window.removeEventListener('storage', other);
  };
}

/** The printer chosen for a role: '' = default printer, null = don't print. */
export function printerFor(settings: PrintSettings, role: string): string | null {
  const choice = settings.printers[role];
  return choice === undefined ? '' : choice;
}

export function isPrintingConfigured(settings: PrintSettings): boolean {
  return settings.token !== '';
}

export function isThisComputerUrl(url: string): boolean {
  return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/i.test(url);
}

/** A BridgeClient for these settings (throws when there's no token yet). */
export function bridgeFor(settings: PrintSettings, timeoutMs?: number): BridgeClient {
  return new BridgeClient({ url: settings.url, token: settings.token, timeoutMs });
}

// ---- Connecting ----

export interface BridgeConnection {
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
export async function connectToBridge(url: string, token: string): Promise<BridgeConnection> {
  if (!token) throw new BridgeError('Paste the access token from the bridge first.', 400);
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
export async function pairDevice(url: string, code: string, deviceName: string): Promise<{ url: string; token: string }> {
  const paired = await BridgeClient.pair({ url, code, name: deviceName || 'POS device' });
  return { url: paired.url, token: paired.token };
}

// ---- Printing ----

export type PrintOutcome =
  | { ok: true; printer: string }
  /** Printing isn't set up, or the shop chose "Don't print" for this role. */
  | { ok: false; skipped: true }
  /** canRetry false: no answer, so it may have printed. Ask before reprinting. */
  | { ok: false; skipped?: false; message: string; canRetry: boolean };

function failed(error: unknown): PrintOutcome {
  if (error instanceof BridgeError) return { ok: false, message: error.message, canRetry: error.status !== 0 };
  return { ok: false, message: 'Printing failed.', canRetry: true };
}

export interface PrintForOptions extends StorageOptions {
  title?: string;
  /** Default: the saved number of copies. */
  copies?: number;
}

/**
 * Print to the printer the shop chose for this role. Never throws: a printer
 * problem must not break a sale. Show `message` and a Reprint button when !ok.
 */
export async function printFor(
  role: string,
  receipt: ReceiptBuilder | ReceiptDocument,
  options: PrintForOptions = {},
): Promise<PrintOutcome> {
  const settings = loadPrintSettings(options);
  const printer = printerFor(settings, role);
  if (!isPrintingConfigured(settings) || printer === null) return { ok: false, skipped: true };
  try {
    const result = await bridgeFor(settings).printReceipt(receipt, {
      printer: printer || undefined,
      copies: options.copies ?? settings.copies,
      title: options.title,
    });
    return { ok: true, printer: result.printer };
  } catch (error) {
    return failed(error);
  }
}

/** An A4 page from HTML, to the printer chosen for this role (default 'invoice'). */
export async function printInvoice(
  html: string,
  options: PrintForOptions & { role?: string } = {},
): Promise<PrintOutcome> {
  const settings = loadPrintSettings(options);
  const printer = printerFor(settings, options.role ?? 'invoice');
  if (!isPrintingConfigured(settings) || printer === null) return { ok: false, skipped: true };
  try {
    const result = await bridgeFor(settings).printDocument(
      { html },
      { printer: printer || undefined, title: options.title, copies: options.copies },
    );
    return { ok: true, printer: result.printer };
  } catch (error) {
    return failed(error);
  }
}

/** The bridge's test page, on the printer chosen for this role. */
export async function printTestPageFor(role: string, options: StorageOptions = {}): Promise<PrintOutcome> {
  const settings = loadPrintSettings(options);
  const printer = printerFor(settings, role);
  if (!isPrintingConfigured(settings) || printer === null) return { ok: false, skipped: true };
  try {
    const result = await bridgeFor(settings).printTestPage(printer || undefined);
    return { ok: true, printer: result.printer };
  } catch (error) {
    return failed(error);
  }
}

// ---- Live status for the POS header ----

export interface PrinterStatusSummary {
  /** ok = green, warning = amber, error = red, off = grey (not set up / switched off). */
  light: StatusLevel;
  /** One line for the cashier, e.g. "Front counter: Out of paper". */
  text: string;
  /** What to do about it, from the bridge. Empty when all is well. */
  steps: string[];
}

type StatusPayload = { printers?: Array<{ level: StatusLevel; title: string; name: string; steps?: string[] }> };

export function summarizeStatus(status: StatusPayload): PrinterStatusSummary {
  const printers = status?.printers ?? [];
  if (printers.length === 0) {
    return { light: 'warning', text: 'No printers set up in the bridge', steps: ['Add a printer in POS Hardware Bridge.'] };
  }
  const worst =
    printers.find((p) => p.level === 'error') ??
    printers.find((p) => p.level === 'warning') ??
    printers.find((p) => p.level === 'off');
  return worst
    ? { light: worst.level, text: `${worst.name}: ${worst.title}`, steps: worst.steps ?? [] }
    : { light: 'ok', text: 'Printers ready', steps: [] };
}

function unreachable(error: unknown): PrinterStatusSummary {
  return {
    light: 'error',
    text: error instanceof BridgeError ? error.message : 'Bridge not reachable',
    steps: [],
  };
}

export interface WatchStatusOptions extends StorageOptions {
  /** Safety-net check, in ms, for a dropped socket or a bridge restart. Default 10000. */
  pollMs?: number;
}

/**
 * Calls `onChange` now and whenever a printer's status changes (live, over a
 * WebSocket), and checks every 10 s as a safety net. Returns stop().
 */
export function watchPrinterStatus(
  onChange: (summary: PrinterStatusSummary) => void,
  options: WatchStatusOptions = {},
): () => void {
  const settings = loadPrintSettings(options);
  if (!isPrintingConfigured(settings)) {
    onChange({ light: 'off', text: 'Printing not set up', steps: ['Open Settings → Printers.'] });
    return () => {};
  }
  const bridge = bridgeFor(settings, 5000);
  let stopped = false;
  let stopListening = () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;

  const check = async () => {
    try {
      const summary = summarizeStatus(await bridge.status());
      if (!stopped) onChange(summary);
    } catch (error) {
      if (!stopped) onChange(unreachable(error));
    }
  };
  const poll = async () => {
    await check();
    if (!stopped) timer = setTimeout(poll, options.pollMs ?? 10_000);
  };

  void poll();
  if (typeof WebSocket !== 'undefined') {
    try {
      stopListening = bridge.onStatus((payload) => {
        if (!stopped) onChange(summarizeStatus(payload as StatusPayload));
      });
    } catch {
      // no live updates; polling still runs
    }
  }
  return () => {
    stopped = true;
    clearTimeout(timer);
    stopListening();
  };
}
