import { transform } from 'receiptline';
import { getConfig, resolvePrinter } from '../config-store';
import type { PrinterProfile } from '../types';
import { printHtml } from './document.service';
import { buildDriver, finishReceipt, friendlyError, sendThermal } from './printer.service';

/**
 * ReceiptLine (https://github.com/receiptline/receiptline) is the receipt
 * document format the bridge accepts from any POS: an open, documented
 * "Markdown for receipts". It prints with the printer's own fonts — sharp,
 * correctly sized for the paper, and fast — instead of as a picture, and the
 * same document renders as an SVG preview for the POS screen.
 */

/** Largest document accepted (a receipt with an embedded logo is ~5–60 KB). */
export const MAX_RECEIPTLINE_LENGTH = 500_000;
/** Characters per line used for previews and A4 printing (an 80mm roll). */
const DEFAULT_CPL = 42;

/**
 * 'generic' rather than 'escpos': plain ESC/POS draws QR codes and logos with
 * Epson's newer GS 8 L / GS ( L graphics commands, which most non-Epson
 * printers (Xprinter, Rongta, POS-80 clones…) don't know — they print the image
 * bytes as a metre of garbage characters. 'generic' uses GS v 0, which every
 * ESC/POS printer supports; text and layout commands are the same.
 */
function commandFor(profile: PrinterProfile): 'generic' | 'starsbcs' {
  return profile.language === 'star' ? 'starsbcs' : 'generic';
}

export interface ReceiptLineOptions {
  copies?: number;
  /** false: leave the paper uncut (e.g. several tickets in a row). */
  cut?: boolean;
  title?: string | null;
}

/** The SVG preview of a document as it will print, laid out for `cpl` columns. */
export function receiptLineSvg(doc: string, cpl = DEFAULT_CPL, encoding: PrinterProfile['encoding'] = 'multilingual'): string {
  return transform(doc, { cpl, encoding, spacing: true });
}

/** Preview on the given printer (or the default receipt printer): same width it prints at. */
export function previewReceiptLine(doc: string, printerId?: string): { svg: string; cpl: number; printer: string | null } {
  const receiptPrinters = getConfig().printers.filter((p) => p.kind === 'receipt');
  const profile = printerId ? resolvePrinter('receipt', printerId) : receiptPrinters[0];
  const cpl = profile?.kind === 'receipt' ? profile.paperWidthChars : DEFAULT_CPL;
  return { svg: receiptLineSvg(doc, cpl, profile?.encoding), cpl, printer: profile?.id ?? null };
}

/** An A4/A5 printer prints the receipt as a centred column, through its driver. */
function receiptPageHtml(svg: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { margin: 12mm; }
    html, body { margin: 0; background: #fff; }
    .receipt { width: 80mm; margin: 0 auto; }
    .receipt svg { width: 100%; height: auto; }
  </style></head><body><div class="receipt">${svg}</div></body></html>`;
}

/** Print a ReceiptLine document on the named printer, or the default receipt printer. */
export async function printReceiptLine(doc: string, printerId?: string, options: ReceiptLineOptions = {}): Promise<PrinterProfile> {
  const profile = resolvePrinter('receipt', printerId);
  const copies = Math.max(1, Math.min(options.copies ?? 1, 5));
  const docName = options.title?.trim() || 'Receipt';
  try {
    if (profile.kind === 'document') {
      await printHtml(profile, receiptPageHtml(receiptLineSvg(doc, DEFAULT_CPL, profile.encoding)), { docName, copies });
      return profile;
    }
    const commands = Buffer.from(
      transform(doc, {
        cpl: profile.paperWidthChars,
        encoding: profile.encoding,
        command: commandFor(profile),
        // Text, logos, barcodes and QR codes: crisp black and white.
        gradient: false,
        // Normal gap between lines, as in the preview. Without it ReceiptLine
        // sets line spacing to 0 and the lines print squashed together.
        spacing: true,
        // Feed and cut follow this printer's settings (cutter / extra paper).
        cutting: false,
      }),
      'binary',
    );
    const driver = buildDriver(profile);
    for (let copy = 0; copy < copies; copy++) {
      driver.append(commands);
      finishReceipt(driver, profile, options.cut !== false);
    }
    await sendThermal(driver, profile, docName);
    return profile;
  } catch (err) {
    throw friendlyError(err, profile);
  }
}
