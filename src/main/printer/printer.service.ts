import { printer as ThermalPrinter, types as PrinterTypes } from 'node-thermal-printer';
import { getConfig } from '../config-store';
import type { PrinterConfig, ReceiptModel } from '../types';
import { getBackend } from './backend';

function buildInterfaceString(config: PrinterConfig): string {
  if (config.connectionType === 'network') {
    return `tcp://${config.network.host}:${config.network.port}`;
  }
  const name = config.usb.systemPrinterName?.trim();
  if (!name) {
    throw new Error('No system printer name configured for USB printer');
  }
  return `printer:${name}`;
}

function buildDriver(config: PrinterConfig) {
  return new ThermalPrinter({
    type: config.driver === 'star' ? PrinterTypes.STAR : PrinterTypes.EPSON,
    interface: buildInterfaceString(config),
    width: config.paperWidthChars,
    removeSpecialCharacters: false,
    options: { timeout: 5000 },
    // USB jobs are sent by sendViaOs() below; the library only builds the bytes,
    // but it insists on a driver object for `printer:` interfaces.
    driver: config.connectionType === 'usb' ? {} : undefined,
  });
}

function money(amountMinorUnits: number, currency: string): string {
  return `${(amountMinorUnits / 100).toFixed(2)} ${currency}`;
}

function renderReceipt(driver: ReturnType<typeof buildDriver>, receipt: ReceiptModel): void {
  driver.alignCenter();
  driver.bold(true);
  driver.println(receipt.businessName);
  driver.bold(false);
  if (receipt.locationName) driver.println(receipt.locationName);
  driver.drawLine();

  driver.alignLeft();
  driver.println(`Sale: ${receipt.saleReference}`);
  driver.println(receipt.timestamp);
  driver.drawLine();

  for (const line of receipt.lines) {
    const qtyPrefix = line.qty && line.qty > 1 ? `${line.qty}x ` : '';
    driver.tableCustom([
      { text: `${qtyPrefix}${line.label}`, align: 'LEFT', width: 0.6 },
      { text: money(line.totalAmount, receipt.currency), align: 'RIGHT', width: 0.4 },
    ]);
  }
  driver.drawLine();

  driver.tableCustom([
    { text: 'Subtotal', align: 'LEFT', width: 0.6 },
    { text: money(receipt.subtotalAmount, receipt.currency), align: 'RIGHT', width: 0.4 },
  ]);
  driver.tableCustom([
    { text: 'Tax', align: 'LEFT', width: 0.6 },
    { text: money(receipt.taxAmount, receipt.currency), align: 'RIGHT', width: 0.4 },
  ]);
  driver.bold(true);
  driver.tableCustom([
    { text: 'Total', align: 'LEFT', width: 0.6 },
    { text: money(receipt.totalAmount, receipt.currency), align: 'RIGHT', width: 0.4 },
  ]);
  driver.bold(false);
  driver.println(`Paid by ${receipt.paymentMethod}`);

  if (receipt.footer) {
    driver.drawLine();
    driver.alignCenter();
    driver.println(receipt.footer);
  }

  driver.cut();
}

/** Turn library/OS errors into something a shop operator can act on. */
function friendlyError(err: unknown, config: PrinterConfig): Error {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  if (/disabled in settings/i.test(raw)) return new Error('No printer is set up yet. Open the bridge settings and pick a printer.');
  if (/No system printer name/i.test(raw)) return new Error('No printer selected. Open the bridge settings and pick a printer.');
  if (config.connectionType === 'network' && /ECONNREFUSED|EHOSTUNREACH|ETIMEDOUT|timeout|not reachable/i.test(raw)) {
    return new Error(`Can't reach the printer at ${config.network.host}:${config.network.port}. Check it is on and on the same network.`);
  }
  if (/not reachable|NOT-AVAILABLE|false/i.test(raw) || raw === '') {
    return new Error('The printer is not connected. Check the USB cable and that the printer is turned on.');
  }
  if (/paused/i.test(raw)) return new Error(raw);
  if (/does not exist|Unknown destination|lp: |invalid printer name|1801/i.test(raw)) {
    return new Error('The selected printer was removed from this computer. Open the bridge settings and pick it again.');
  }
  return new Error(raw);
}

/** Send through the OS print queue, but only when the printer is really there:
 * a job queued for an unplugged printer would print later as a surprise duplicate. */
async function sendViaOs(queueName: string, data: Buffer, docName: string): Promise<void> {
  const backend = getBackend();
  const [queues, usb] = await Promise.all([backend.listQueues(), backend.listUsbDevices()]);
  const queue = queues.find((q) => q.name === queueName);
  if (!queue) throw new Error('Unknown destination');
  if (queue.connection === 'usb' && !usb.some((d) => d.id === queue.usbDeviceId)) {
    throw new Error('Printer not reachable');
  }
  if (!queue.enabled) {
    throw new Error('Printing is paused on this computer. Open the bridge settings and click “Resume printing”.');
  }
  await backend.sendRaw(queueName, data, docName);
}

async function send(driver: ReturnType<typeof buildDriver>, config: PrinterConfig, docName = 'Receipt'): Promise<void> {
  try {
    if (config.connectionType === 'usb') {
      await sendViaOs(config.usb.systemPrinterName?.trim() ?? '', driver.getBuffer(), docName);
      return;
    }
    const connected = await driver.isPrinterConnected().catch(() => false);
    if (!connected) throw new Error('Printer not reachable');
    await driver.execute();
  } catch (err) {
    throw friendlyError(err, config);
  }
}

export async function printReceipt(receipt: ReceiptModel): Promise<void> {
  const config = getConfig().printer;
  try {
    if (!config.enabled) throw new Error('Printer is disabled in settings');
    const driver = buildDriver(config);
    renderReceipt(driver, receipt);
    await send(driver, config);
  } catch (err) {
    throw friendlyError(err, config);
  }
}

export async function printTestPage(): Promise<void> {
  const config = getConfig().printer;
  try {
    const driver = buildDriver(config);
    const where =
      config.connectionType === 'network'
        ? `${config.network.host}:${config.network.port}`
        : config.usb.systemPrinterName ?? '';
    driver.alignCenter();
    driver.bold(true);
    driver.println('POS Hardware Bridge');
    driver.bold(false);
    driver.println('Test print OK');
    driver.drawLine();
    driver.alignLeft();
    driver.println(`Printer: ${where}`);
    driver.println(`Width: ${config.paperWidthChars} characters`);
    driver.println(new Date().toLocaleString());
    // Ruler: the last digit should sit exactly at the right edge of the paper.
    driver.println('1234567890'.repeat(Math.ceil(config.paperWidthChars / 10)).slice(0, config.paperWidthChars));
    driver.cut();
    await send(driver, config, 'Test page');
  } catch (err) {
    throw friendlyError(err, config);
  }
}

export async function printRaw(escposBase64: string): Promise<void> {
  const config = getConfig().printer;
  try {
    const driver = buildDriver(config);
    const data = Buffer.from(escposBase64, 'base64');
    if (config.connectionType === 'usb') {
      await sendViaOs(config.usb.systemPrinterName?.trim() ?? '', data, 'Raw job');
    } else {
      await driver.raw(data);
    }
  } catch (err) {
    throw friendlyError(err, config);
  }
}
