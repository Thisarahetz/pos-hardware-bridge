import { resolvePrinter } from '../config-store';
import type { PrinterProfile } from '../types';
import { layoutReceipt, type ReceiptDocument, type ReceiptTextSize } from './receipt-layout';
import { printHtml } from './document.service';
import { buildDriver, finishReceipt, friendlyError, printQr, sendThermal, type Driver } from './printer.service';
import { normalizeQr, qrSvg } from './qr';
import { logoPngForReceipt } from './logo';

/**
 * Receipts sent line by line (`{ "blocks": [...] }`): each line is printed with
 * the printer's own commands and fonts — bold, double size, white on black,
 * alignment, rules and QR codes — the same way the bridge always printed its
 * receipts. Nothing is turned into HTML, a PDF or a picture, so text is as
 * sharp as the printer can make it and works on any ESC/POS or Star printer.
 */

function setSize(driver: Driver, size: ReceiptTextSize): void {
  if (size === 'wide') driver.setTextDoubleWidth();
  else if (size === 'tall') driver.setTextDoubleHeight();
  else if (size === 'large') driver.setTextQuadArea();
  else driver.setTextNormal();
}

export async function renderThermal(driver: Driver, profile: PrinterProfile, doc: ReceiptDocument): Promise<void> {
  for (const o of layoutReceipt(doc.blocks, profile.paperWidthChars)) {
    if (o.kind === 'feed') {
      for (let i = 0; i < o.lines; i++) driver.newLine();
      continue;
    }
    if (o.kind === 'qr') {
      await printQr(driver, profile, normalizeQr({ data: o.data, label: o.label, size: o.size }));
      continue;
    }
    if (o.kind === 'image') {
      driver.alignCenter();
      await driver.printImageBuffer(logoPngForReceipt(o.data, o.size, profile.paperWidthChars));
      driver.alignLeft();
      continue;
    }
    if (o.align === 'center') driver.alignCenter();
    else if (o.align === 'right') driver.alignRight();
    else driver.alignLeft();
    if (o.bold) driver.bold(true);
    if (o.underline) driver.underline(true);
    if (o.invert) driver.invert(true);
    setSize(driver, o.size);
    driver.println(o.text);
    // Back to plain text so one line's style never leaks into the next.
    if (o.bold) driver.bold(false);
    if (o.underline) driver.underline(false);
    if (o.invert) driver.invert(false);
    if (o.size !== 'normal') driver.setTextNormal();
    driver.alignLeft();
  }
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

/** For an A4/A5 printer, which can't take printer commands: the same lines in a monospace column. */
async function receiptPage(doc: ReceiptDocument, width: number): Promise<string> {
  const parts: string[] = [];
  for (const o of layoutReceipt(doc.blocks, width)) {
    if (o.kind === 'feed') parts.push('<div>&nbsp;</div>'.repeat(o.lines));
    else if (o.kind === 'image') {
      const src = o.data.startsWith('data:') ? o.data : `data:image/png;base64,${o.data}`;
      parts.push(`<div class="img ${o.size}"><img src="${escapeHtml(src)}"></div>`);
    } else if (o.kind === 'qr') {
      parts.push(`<div class="qr ${o.size}">${await qrSvg(o.data)}${o.label ? `<div>${escapeHtml(o.label)}</div>` : ''}</div>`);
    } else {
      const cls = [o.bold && 'b', o.underline && 'u', o.invert && 'i', `s-${o.size}`].filter(Boolean).join(' ');
      parts.push(`<div class="${cls}" style="text-align:${o.align}">${escapeHtml(o.text) || '&nbsp;'}</div>`);
    }
  }
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { margin: 12mm; }
    body { margin: 0; }
    .r { width: ${width}ch; margin: 0 auto; font: 10pt/1.35 "Courier New", Courier, monospace; white-space: pre; color: #000; }
    .b { font-weight: 700; } .u { text-decoration: underline; } .i { background: #000; color: #fff; display: table; margin: 0 auto; }
    .s-wide { transform: scaleX(2); transform-origin: left; width: 50%; } .s-tall { font-size: 15pt; } .s-large { font-size: 20pt; }
    .img { text-align: center; margin: 2mm 0; } .img img { max-width: 100%; }
    .img.small img { width: 24mm; } .img.medium img { width: 36mm; } .img.large img { width: 48mm; } .img.full img { width: 100%; }
    .qr { text-align: center; margin: 3mm 0; white-space: normal; } .qr svg { display: block; margin: 0 auto 1mm; }
    .qr.small svg { width: 22mm; } .qr.medium svg { width: 30mm; } .qr.large svg { width: 40mm; }
  </style></head><body><div class="r">${parts.join('')}</div></body></html>`;
}

export interface ReceiptBlocksOptions {
  copies?: number;
  /** false: leave the paper uncut. */
  cut?: boolean;
  title?: string | null;
}

/** Print a line-by-line receipt on the named printer, or the default receipt printer. */
export async function printReceiptBlocks(doc: ReceiptDocument, printerId?: string, options: ReceiptBlocksOptions = {}): Promise<PrinterProfile> {
  const profile = resolvePrinter('receipt', printerId);
  const copies = Math.max(1, Math.min(options.copies ?? 1, 5));
  const docName = options.title?.trim() || 'Receipt';
  try {
    if (profile.kind === 'document') {
      await printHtml(profile, await receiptPage(doc, 42), { docName, copies });
      return profile;
    }
    const driver = buildDriver(profile);
    for (let copy = 0; copy < copies; copy++) {
      await renderThermal(driver, profile, doc);
      finishReceipt(driver, profile, options.cut !== false);
    }
    await sendThermal(driver, profile, docName);
    return profile;
  } catch (err) {
    throw friendlyError(err, profile);
  }
}
