import { addPrinter, getConfig, newProfileDefaults, uniquePrinterId } from '../config-store';
import type { PrinterKind, PrinterProfile } from '../types';
import { getBackend } from './backend';
import { discoverPrinters, type DiscoveredPrinter } from './discovery';

/** Small portable printers are almost always 58mm (32 chars); desktop ones 80mm (42). */
function guessPaperWidth(label: string): number {
  return /58|portable|mini|mobile/i.test(label) ? 32 : 42;
}

export interface AddPrinterOptions {
  kind: PrinterKind;
  /** Friendly name; defaults to the printer's own name. */
  name?: string;
  /** API name; defaults to "receipt" / "invoice" (made unique). */
  id?: string;
}

/** Add a discovered printer to the bridge, installing it in the OS first if needed. */
export async function addDiscoveredPrinter(printer: DiscoveredPrinter, options: AddPrinterOptions): Promise<PrinterProfile> {
  const { kind } = options;
  let connection: PrinterProfile['connection'];

  if (printer.queueName) {
    connection = { type: 'system', queueName: printer.queueName };
  } else if (printer.kind === 'network' && printer.host) {
    if (kind === 'document') {
      throw new Error(
        'To print A4 documents on a network printer, first add it in the computer’s printer settings, then click “Search again”.',
      );
    }
    connection = { type: 'tcp', host: printer.host, port: printer.port ?? 9100 };
  } else if (printer.usbDeviceId) {
    const queueName = await getBackend().installUsb({ id: printer.usbDeviceId, label: printer.label });
    connection = { type: 'system', queueName };
  } else {
    throw new Error('This printer cannot be added automatically.');
  }

  const profile: PrinterProfile = {
    ...newProfileDefaults(kind),
    id: uniquePrinterId(options.id?.trim() || (kind === 'receipt' ? 'receipt' : 'invoice')),
    name: options.name?.trim() || printer.label,
    connection,
    paperWidthChars: guessPaperWidth(printer.label),
  };
  addPrinter(profile);
  return profile;
}

// Only try each device once per run, so a failed setup (or a declined Windows
// permission prompt) isn't retried every few seconds.
const attempted = new Set<string>();

/** While no receipt printer is configured, set up the one obvious receipt
 * printer that is plugged in. Office (A4) printers are never added on their
 * own: the operator chooses those. Returns the new printer, if any. */
export async function autoSetupPrinter(): Promise<PrinterProfile | null> {
  const config = getConfig();
  if (!config.app.autoDetectPrinters) return null;
  if (config.printers.some((p) => p.kind === 'receipt')) return null;

  const usedQueues = new Set(
    config.printers.map((p) => (p.connection.type === 'system' ? p.connection.queueName : '')).filter(Boolean),
  );
  const candidates = (await discoverPrinters()).filter(
    (p) => p.kind === 'usb' && p.online && p.likelyReceiptPrinter && !(p.queueName && usedQueues.has(p.queueName)),
  );
  const pick = candidates.length === 1 ? candidates[0] : null;
  if (!pick || attempted.has(pick.id)) return null;
  attempted.add(pick.id);
  return addDiscoveredPrinter(pick, { kind: 'receipt', name: 'Receipt printer' });
}
