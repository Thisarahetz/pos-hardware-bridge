import Store from 'electron-store';
import { randomBytes } from 'node:crypto';
import type { BridgeConfig, LegacyPrinterConfig, PrinterKind, PrinterProfile } from './types';

const defaults: BridgeConfig = {
  app: {
    launchAtLogin: true,
    autoDetectPrinters: true,
  },
  server: {
    port: 9191,
    authToken: randomBytes(24).toString('hex'),
    allowNetwork: false,
  },
  printers: [],
  terminal: {
    enabled: false,
    serialPath: '',
    baudRate: 9600,
    responseTimeoutMs: 30000,
  },
};

// electron-store persists as plain JSON under the OS user-data dir; the auth token
// is a localhost-only shared secret (see server.ts), not a credential worth encrypting.
const store = new Store<BridgeConfig & { printer?: LegacyPrinterConfig }>({ defaults });

/** Move a pre-multi-printer config (one `printer` object) into the `printers` list. */
function migrateLegacyPrinter(): void {
  const legacy = store.get('printer');
  if (!legacy) return;
  const printers: PrinterProfile[] = [];
  const queueName = legacy.usb?.systemPrinterName?.trim();
  if (legacy.enabled && (legacy.connectionType === 'network' || queueName)) {
    printers.push({
      ...newProfileDefaults('receipt'),
      id: 'receipt',
      name: 'Receipt printer',
      connection:
        legacy.connectionType === 'network'
          ? { type: 'tcp', host: legacy.network.host, port: legacy.network.port }
          : { type: 'system', queueName: queueName as string },
      language: legacy.driver,
      paperWidthChars: legacy.paperWidthChars,
    });
  }
  store.set('printers', [...printers, ...(store.get('printers') ?? [])]);
  store.set('app', { ...defaults.app, ...store.get('app'), autoDetectPrinters: legacy.autoDetect !== false });
  store.delete('printer');
}
migrateLegacyPrinter();

export function getConfig(): BridgeConfig {
  // Pick the known sections only: the store also holds the cloud link (with
  // the station token), which must never reach the settings window.
  const config = store.store;
  // Fill in settings added after a printer was saved (e.g. the cutter option).
  const printers = (config.printers ?? []).map((p) => ({ ...newProfileDefaults(p.kind), ...p }));
  return {
    app: { ...defaults.app, ...config.app },
    server: { ...defaults.server, ...config.server },
    printers,
    terminal: config.terminal,
  };
}

export type ConfigPatch = {
  app?: Partial<BridgeConfig['app']>;
  server?: Partial<BridgeConfig['server']>;
  terminal?: Partial<BridgeConfig['terminal']>;
};

/** Merges each section, so callers can change one field without resending the rest. */
export function updateConfig(patch: ConfigPatch): BridgeConfig {
  const current = getConfig();
  store.set({
    app: { ...current.app, ...patch.app },
    server: { ...current.server, ...patch.server },
    printers: current.printers,
    terminal: { ...current.terminal, ...patch.terminal },
  });
  return getConfig();
}

export function regenerateAuthToken(): string {
  const token = randomBytes(24).toString('hex');
  store.set('server.authToken', token);
  return token;
}

// ---------- printers ----------

export function newProfileDefaults(kind: PrinterKind): Omit<PrinterProfile, 'id' | 'name' | 'connection'> {
  return { kind, language: 'epson', encoding: 'multilingual', paperWidthChars: 42, cutter: 'full', feedLines: 3, qrMode: 'image', billPrint: 'auto', paperSize: 'A4' };
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
}

/** A short, unique API name such as "receipt", "receipt-2" or "invoice". */
export function uniquePrinterId(wanted: string): string {
  const taken = new Set(getConfig().printers.map((p) => p.id));
  const base = slug(wanted) || 'printer';
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

function savePrinters(printers: PrinterProfile[]): PrinterProfile[] {
  store.set('printers', printers);
  return printers;
}

export function addPrinter(profile: PrinterProfile): PrinterProfile[] {
  return savePrinters([...getConfig().printers, profile]);
}

export function updatePrinter(id: string, patch: Partial<Omit<PrinterProfile, 'id'>>): PrinterProfile[] {
  const printers = getConfig().printers;
  if (!printers.some((p) => p.id === id)) throw new Error(`No printer named "${id}"`);
  return savePrinters(printers.map((p) => (p.id === id ? { ...p, ...patch } : p)));
}

/** Change a printer's API name. Note: POS apps using the old name must be updated. */
export function renamePrinterId(id: string, wanted: string): PrinterProfile[] {
  const newId = slug(wanted);
  if (!newId) throw new Error('API name must contain letters or numbers');
  const printers = getConfig().printers;
  if (printers.some((p) => p.id === newId && p.id !== id)) throw new Error(`Another printer is already called "${newId}"`);
  return savePrinters(printers.map((p) => (p.id === id ? { ...p, id: newId } : p)));
}

export function removePrinter(id: string): PrinterProfile[] {
  return savePrinters(getConfig().printers.filter((p) => p.id !== id));
}

/** Make this printer the default for its kind by moving it to the front. */
export function makeDefaultPrinter(id: string): PrinterProfile[] {
  const printers = getConfig().printers;
  const target = printers.find((p) => p.id === id);
  if (!target) throw new Error(`No printer named "${id}"`);
  return savePrinters([target, ...printers.filter((p) => p.id !== id)]);
}

/** Find the printer for a request: by API name, or the default for that kind. */
export function resolvePrinter(kind: PrinterKind, id?: string): PrinterProfile {
  const printers = getConfig().printers;
  if (id) {
    const found = printers.find((p) => p.id === id);
    if (!found) {
      const names = printers.map((p) => `"${p.id}"`).join(', ') || 'none';
      throw new UnknownPrinterError(`No printer named "${id}". Available printers: ${names}.`);
    }
    return found;
  }
  const fallback = printers.find((p) => p.kind === kind) ?? printers[0];
  if (!fallback) {
    throw new UnknownPrinterError(
      kind === 'receipt'
        ? 'No receipt printer is set up yet. Open the bridge settings and add one.'
        : 'No A4/document printer is set up yet. Open the bridge settings and add one.',
    );
  }
  return fallback;
}

export class UnknownPrinterError extends Error {}

export default store;
