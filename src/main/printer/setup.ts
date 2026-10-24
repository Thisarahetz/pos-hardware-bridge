import { getConfig, updateConfig } from '../config-store';
import { getBackend } from './backend';
import { discoverPrinters, type DiscoveredPrinter } from './discovery';

/** Small portable printers are almost always 58mm (32 chars); desktop ones 80mm (42). */
function guessPaperWidth(label: string): number {
  return /58|portable|mini|mobile/i.test(label) ? 32 : 42;
}

/** Point the bridge at a discovered printer, installing it in the OS first if needed. */
export async function usePrinter(printer: DiscoveredPrinter): Promise<void> {
  if (printer.kind === 'network' && !printer.queueName && printer.host) {
    updateConfig({
      printer: {
        enabled: true,
        autoDetect: true,
        connectionType: 'network',
        network: { host: printer.host, port: printer.port ?? 9100 },
      },
    });
    return;
  }

  let queueName = printer.queueName;
  if (!queueName) {
    if (!printer.usbDeviceId) throw new Error('This printer cannot be set up automatically.');
    queueName = await getBackend().installUsb({ id: printer.usbDeviceId, label: printer.label });
  }
  const switchingPrinter = getConfig().printer.usb.systemPrinterName !== queueName;
  updateConfig({
    printer: {
      enabled: true,
      autoDetect: true,
      connectionType: 'usb',
      usb: { systemPrinterName: queueName },
      ...(switchingPrinter ? { paperWidthChars: guessPaperWidth(printer.label) } : {}),
    },
  });
}

function needsPrinter(): boolean {
  const p = getConfig().printer;
  if (p.autoDetect === false) return false;
  if (!p.enabled) return true;
  return p.connectionType === 'usb' && !p.usb.systemPrinterName?.trim();
}

// Only try each device once per run, so a failed setup (or a declined Windows
// permission prompt) isn't retried every few seconds.
const attempted = new Set<string>();

/** If no printer is configured yet and exactly one obvious receipt printer is
 * plugged in, set it up. Returns the printer it picked, if any. */
export async function autoSetupPrinter(): Promise<DiscoveredPrinter | null> {
  if (!needsPrinter()) return null;
  const usb = (await discoverPrinters()).filter((p) => p.kind === 'usb' && p.online);
  const receipt = usb.filter((p) => p.likelyReceiptPrinter);
  const pick = receipt.length === 1 ? receipt[0] : usb.length === 1 ? usb[0] : null;
  if (!pick || attempted.has(pick.id)) return null;
  attempted.add(pick.id);
  await usePrinter(pick);
  return pick;
}
