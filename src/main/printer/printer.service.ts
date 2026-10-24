import { printer as ThermalPrinter, types as PrinterTypes } from 'node-thermal-printer';
import { resolvePrinter } from '../config-store';
import type { PrinterProfile, ReceiptModel } from '../types';
import { getBackend } from './backend';
import { ensureQueueReady } from './availability';
import { money, printHtml, printPdf, receiptHtml, testPageHtml } from './document.service';
import { nativeCellSize, normalizeQr, printableDots, qrPngForReceipt } from './qr';
import { renderHtmlToRaster } from './html-raster';
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

/** End of a receipt: feed paper, then cut (or leave it to tear off). */
function finishReceipt(driver: Driver, profile: PrinterProfile, cut = true): void {
  const lines = Math.max(0, Math.min(profile.feedLines ?? 3, 12));
  for (let i = 0; i < lines; i++) driver.newLine();
  if (!cut || profile.cutter === 'none') return;
  if (profile.cutter === 'partial') driver.partialCut({ verticalTabAmount: 0 });
  else driver.cut({ verticalTabAmount: 0 });
}

/** Centered QR code with an optional caption. */
async function printQr(driver: Driver, profile: PrinterProfile, qr: ReturnType<typeof normalizeQr>): Promise<void> {
  driver.newLine();
  driver.alignCenter();
  if (profile.qrMode === 'native') {
    driver.printQR(qr.data, { cellSize: nativeCellSize(qr, profile.paperWidthChars), correction: 'M', model: 2 });
  } else {
    await driver.printImageBuffer(await qrPngForReceipt(qr, profile.paperWidthChars));
  }
  if (qr.label) driver.println(qr.label);
  driver.alignLeft();
}

async function renderReceipt(driver: Driver, profile: PrinterProfile, receipt: ReceiptModel): Promise<void> {
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

  if (receipt.qrCode) await printQr(driver, profile, normalizeQr(receipt.qrCode));

  if (receipt.footer) {
    driver.drawLine();
    driver.alignCenter();
    driver.println(receipt.footer);
  }
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
export async function printReceipt(receipt: ReceiptModel, printerId?: string, cut = true): Promise<PrinterProfile> {
  const profile = resolvePrinter('receipt', printerId);
  try {
    if (profile.kind === 'document') {
      await printHtml(profile, await receiptHtml(receipt), { docName: `Receipt ${receipt.saleReference}` });
    } else {
      const driver = buildDriver(profile);
      await renderReceipt(driver, profile, receipt);
      finishReceipt(driver, profile, cut);
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
      await printHtml(profile, await testPageHtml(profile), { docName: 'Test page' });
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
    driver.println(`Cutter: ${profile.cutter === 'none' ? 'none (tear off)' : profile.cutter === 'partial' ? 'partial cut' : 'full cut'}`);
    driver.println(new Date().toLocaleString());
    // Ruler: the last digit should sit exactly at the right edge of the paper.
    driver.println('1234567890'.repeat(Math.ceil(profile.paperWidthChars / 10)).slice(0, profile.paperWidthChars));
    await printQr(driver, profile, { data: 'POS Hardware Bridge: QR test OK', label: 'Scan me to test QR codes', size: 'medium' });
    driver.newLine();
    driver.println(
      profile.cutter === 'none'
        ? 'Tear here. If this line is still inside the printer, choose more paper at the end.'
        : 'If the paper was not cut, set the cutter to "No cutter".',
    );
    finishReceipt(driver, profile);
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

/** CSS width a bill page was laid out for, by paper. */
const CSS_WIDTH: Record<string, number> = { '58mm': 219, '80mm': 302 };

export interface HtmlPrintOptions {
  /** Paper the page was laid out for: 80mm / 58mm rolls, or A4 / A5 sheets. */
  format?: string | null;
  copies?: number;
  title?: string | null;
}

/**
 * Print a ready-made HTML page, as the POS lays out its bills. On a thermal
 * printer the page is rendered to an image at the print head's width and
 * printed as raster strips (same look as on screen, no printer driver needed);
 * on an A4/A5 printer it goes through the driver at the requested paper size.
 */
export async function printHtmlPage(html: string, printerId: string | undefined, options: HtmlPrintOptions = {}): Promise<PrinterProfile> {
  const format = (options.format ?? '').toLowerCase();
  const wantsSheet = format === 'a4' || format === 'a5';
  const profile = resolvePrinter(wantsSheet ? 'document' : 'receipt', printerId ?? undefined);
  const copies = Math.max(1, Math.min(options.copies ?? 1, 5));
  const docName = options.title?.trim() || 'Bill';
  try {
    if (profile.kind === 'document') {
      const paperSize = format === 'a5' ? 'A5' : format === 'a4' ? 'A4' : profile.paperSize;
      await printHtml(profile, html, { docName, paperSize, copies });
      return profile;
    }
    const strips = await renderHtmlToRaster(html, {
      dots: printableDots(profile.paperWidthChars),
      cssWidth: CSS_WIDTH[format] ?? CSS_WIDTH['80mm'],
    });
    const driver = buildDriver(profile);
    for (let copy = 0; copy < copies; copy++) {
      driver.alignCenter();
      for (const strip of strips) await driver.printImageBuffer(strip);
      driver.alignLeft();
      finishReceipt(driver, profile);
    }
    await sendThermal(driver, profile, docName);
    return profile;
  } catch (err) {
    throw friendlyError(err, profile);
  }
}
