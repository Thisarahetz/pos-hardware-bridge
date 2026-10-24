import { printer as ThermalPrinter, types as PrinterTypes } from 'node-thermal-printer';
import { resolvePrinter } from '../config-store';
import type { PrinterProfile, ReceiptModel } from '../types';
import { getBackend } from './backend';
import { ensureQueueReady } from './availability';
import { money, printHtml, printPdf, receiptHtml, testPageHtml } from './document.service';
import type { DocumentRequest } from '../validation';

type Driver = InstanceType<typeof ThermalPrinter>;

function buildDriver(profile: PrinterProfile): Driver {
  const { connection } = profile;
  return new ThermalPrinter({
    type: profile.language === 'star' ? PrinterTypes.STAR : PrinterTypes.EPSON,
    interface: connection.type === 'tcp' ? `tcp://${connection.host}:${connection.port}` : `printer:${connection.queueName}`,
    width: profile.paperWidthChars,
    removeSpecialCharacters: false,
    options: { timeout: 5000 },
    // System-queue jobs are sent by sendRaw() below; the library only builds the
    // bytes, but it insists on a driver object for `printer:` interfaces.
    driver: connection.type === 'system' ? {} : undefined,
  });
}

function renderReceipt(driver: Driver, receipt: ReceiptModel): void {
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

/** A device problem the cashier can act on (sent to the POS as HTTP 502). */
export class PrinterError extends Error {}

/** Turn library/OS errors into something a shop operator can act on. */
export function friendlyError(err: unknown, profile: PrinterProfile): Error {
  if (err instanceof PrinterError) return err;
  const raw = err instanceof Error ? err.message : String(err ?? '');
  const who = `“${profile.name}”`;
  const { connection } = profile;
  if (connection.type === 'tcp' && /ECONNREFUSED|EHOSTUNREACH|ETIMEDOUT|timeout|not reachable/i.test(raw)) {
    return new PrinterError(`Can't reach ${who} at ${connection.host}:${connection.port}. Check it is on and on the same network.`);
  }
  if (/not reachable|NOT-AVAILABLE|false/i.test(raw) || raw === '') {
    return new PrinterError(`${who} is not connected. Check the cable and that the printer is turned on.`);
  }
  if (/paused/i.test(raw)) return new PrinterError(`${who}: ${raw}`);
  if (/does not exist|Unknown destination|lp: |invalid printer name|1801/i.test(raw)) {
    return new PrinterError(`${who} was removed from this computer. Open the bridge settings and add it again.`);
  }
  return new PrinterError(`${who}: ${raw}`);
}

async function sendThermal(driver: Driver, profile: PrinterProfile, docName: string): Promise<void> {
  const { connection } = profile;
  if (connection.type === 'system') {
    await ensureQueueReady(connection.queueName);
    await getBackend().sendRaw(connection.queueName, driver.getBuffer(), docName);
    return;
  }
  const connected = await driver.isPrinterConnected().catch(() => false);
  if (!connected) throw new Error('Printer not reachable');
  await driver.execute();
}

/** Print a receipt on the named printer (or the default receipt printer).
 * A4/A5 document printers get the same receipt laid out as a page. */
export async function printReceipt(receipt: ReceiptModel, printerId?: string): Promise<PrinterProfile> {
  const profile = resolvePrinter('receipt', printerId);
  try {
    if (profile.kind === 'document') {
      await printHtml(profile, receiptHtml(receipt), { docName: `Receipt ${receipt.saleReference}` });
    } else {
      const driver = buildDriver(profile);
      renderReceipt(driver, receipt);
      await sendThermal(driver, profile, `Receipt ${receipt.saleReference}`);
    }
    return profile;
  } catch (err) {
    throw friendlyError(err, profile);
  }
}

export async function printTestPage(printerId?: string): Promise<PrinterProfile> {
  const profile = resolvePrinter('receipt', printerId);
  try {
    if (profile.kind === 'document') {
      await printHtml(profile, testPageHtml(profile), { docName: 'Test page' });
      return profile;
    }
    const driver = buildDriver(profile);
    const { connection } = profile;
    const where = connection.type === 'tcp' ? `${connection.host}:${connection.port}` : connection.queueName;
    driver.alignCenter();
    driver.bold(true);
    driver.println('POS Hardware Bridge');
    driver.bold(false);
    driver.println('Test print OK');
    driver.drawLine();
    driver.alignLeft();
    driver.println(`Printer: ${profile.name}`);
    driver.println(`API name: ${profile.id}`);
    driver.println(`Connection: ${where}`);
    driver.println(`Width: ${profile.paperWidthChars} characters`);
    driver.println(new Date().toLocaleString());
    // Ruler: the last digit should sit exactly at the right edge of the paper.
    driver.println('1234567890'.repeat(Math.ceil(profile.paperWidthChars / 10)).slice(0, profile.paperWidthChars));
    driver.cut();
    await sendThermal(driver, profile, 'Test page');
    return profile;
  } catch (err) {
    throw friendlyError(err, profile);
  }
}

/** Print an HTML page or PDF on the named printer (or the default A4/document printer). */
export async function printDocument(request: DocumentRequest): Promise<PrinterProfile> {
  const profile = resolvePrinter('document', request.printer);
  const options = {
    docName: request.title?.trim() || 'Document',
    paperSize: request.paperSize,
    landscape: request.landscape,
    copies: request.copies,
  };
  try {
    if (request.pdfBase64) await printPdf(profile, Buffer.from(request.pdfBase64, 'base64'), options);
    else await printHtml(profile, request.html as string, options);
    return profile;
  } catch (err) {
    throw friendlyError(err, profile);
  }
}
