/**
 * Build receipts as ReceiptLine documents — the open "Markdown for receipts"
 * format (https://github.com/receiptline/receiptline) that POS Hardware Bridge
 * prints with the printer's own fonts on any ESC/POS or Star printer.
 *
 * The builder never assumes a paper width: column widths are written relative
 * to the line (`*` = the rest), so one receipt prints correctly on 58mm
 * (32 characters), 80mm (42/48) and on A4 alike.
 */

export type Align = 'left' | 'center' | 'right';

/** Text size: wide = double width, tall = double height, large = 2×, xlarge = 3×. */
export type TextSize = 'normal' | 'wide' | 'tall' | 'large' | 'xlarge';

export interface TextStyle {
  align?: Align;
  bold?: boolean;
  underline?: boolean;
  /** White on black. */
  invert?: boolean;
  size?: TextSize;
  /** Leading spaces (ReceiptLine trims ordinary ones). */
  indent?: number;
}

export interface ItemLine {
  /** Item name, e.g. "Latte (large)". */
  name: string;
  /** Line total, already formatted, e.g. "9.00" or "Rs 1,250.00". */
  total: string;
  /** Quantity; shown as "2 x" before the name when given. */
  qty?: number | string;
  /** Price per unit, formatted; shown on a second line ("2 x 4.50"). */
  unitPrice?: string;
  /** Extra lines under the item: modifiers, kitchen notes, discounts. */
  notes?: string[];
}

export interface QrOptions {
  /** Module size in printer dots, 3–8 (default 6). */
  cell?: number;
  /** Error correction: l, m (default), q, h. */
  level?: 'l' | 'm' | 'q' | 'h';
  /** Line printed under the code. */
  caption?: string;
}

export interface BarcodeOptions {
  type?: 'code128' | 'code39' | 'code93' | 'ean' | 'upc' | 'itf' | 'codabar';
  /** Bar width in dots, 2–4 (default 2). */
  width?: number;
  /** Height in dots, 24–240 (default 72). */
  height?: number;
  /** Print the digits under the bars (default true). */
  hri?: boolean;
}

const SIZE_MARK: Record<TextSize, string> = { normal: '', wide: '^', tall: '^^', large: '^^^', xlarge: '^^^^' };
const SIZE_WIDTH: Record<TextSize, number> = { normal: 1, wide: 2, tall: 1, large: 2, xlarge: 3 };

/** Escape text so ReceiptLine prints it literally. */
export function escapeText(value: string): string {
  return String(value)
    .replace(/[\r\t]/g, ' ')
    .replace(/[\\|{}\-=~_"`^]/g, (c) => `\\${c}`);
}

/** Escape a property value ({code: …}, {image: …}). */
export function escapeValue(value: string): string {
  return String(value)
    .replace(/[\\|{};]/g, (c) => `\\${c}`)
    .replace(/\r?\n/g, '\\n');
}

function decorate(text: string, style: TextStyle = {}): string {
  let out = escapeText(text);
  if (style.bold) out = `"${out}"`;
  if (style.underline) out = `_${out}_`;
  if (style.invert) out = `\`${out}\``;
  return SIZE_MARK[style.size ?? 'normal'] + out;
}

/** Display width in printer columns (wide characters count double). */
function columns(text: string, size: TextSize = 'normal'): number {
  let n = 0;
  for (const ch of text) n += /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch) ? 2 : 1;
  return n * SIZE_WIDTH[size];
}

export class Receipt {
  private readonly lines: string[] = [];
  /** Column widths currently in force ("auto" or "*,N"); ReceiptLine keeps them. */
  private widths = 'auto';

  private setWidths(widths: string): void {
    if (widths === this.widths) return;
    this.lines.push(`{width:${widths}}`);
    this.widths = widths;
  }

  /** One line of text (wraps when longer than the paper). */
  text(text: string, style: TextStyle = {}): this {
    this.setWidths('auto');
    for (const part of String(text).split(/\r?\n/)) {
      const body = '~'.repeat(Math.max(0, Math.min(style.indent ?? 0, 12))) + decorate(part, style);
      const align = style.align ?? 'left';
      // ReceiptLine aligns a lone column by which side its pipe is on.
      this.lines.push(align === 'center' ? body : align === 'left' ? `${body} |` : `| ${body}`);
    }
    return this;
  }

  /** Big, bold, centred heading — the shop name. */
  title(text: string, size: TextSize = 'large'): this {
    return this.text(text, { align: 'center', bold: true, size });
  }

  /** Centred text, e.g. branch, address, phone. */
  center(text: string, style: Omit<TextStyle, 'align'> = {}): this {
    return this.text(text, { ...style, align: 'center' });
  }

  /** White-on-black label, e.g. "TAX INVOICE" or "REPRINT". */
  banner(text: string): this {
    return this.text(` ${text} `, { align: 'center', invert: true, bold: true });
  }

  /**
   * A label on the left and a value on the right ("Order  #1042"). The value's
   * column is sized to the value so it never wraps; the label gets the rest.
   */
  row(label: string, value: string, style: Omit<TextStyle, 'align'> = {}): this {
    const size = style.size ?? 'normal';
    const right = columns(String(value), size);
    this.setWidths(right > 0 ? `*,${right}` : 'auto');
    this.lines.push(`${decorate(label, style)} | ${decorate(value, style)}`);
    return this;
  }

  /** An item with its total, and optional quantity, unit price and notes. */
  item(line: ItemLine): this {
    const qty = line.qty !== undefined && String(line.qty) !== '' ? `${line.qty} x ` : '';
    this.row(`${qty}${line.name}`, line.total, { bold: true });
    if (line.unitPrice) this.text(`${line.qty ?? 1} x ${line.unitPrice}`, { indent: 2 });
    for (const note of line.notes ?? []) this.text(note, { indent: 2 });
    return this;
  }

  /** A totals row; `emphasis` prints it bold and double-height (the grand total). */
  total(label: string, value: string, options: { emphasis?: boolean } = {}): this {
    return this.row(label, value, options.emphasis ? { bold: true, size: 'tall' } : {});
  }

  /** A full-width rule. */
  divider(): this {
    this.setWidths('auto');
    this.lines.push('-');
    return this;
  }

  /** Blank lines. */
  feed(lines = 1): this {
    this.setWidths('auto');
    for (let i = 0; i < lines; i++) this.lines.push('');
    return this;
  }

  /** A QR code (payment link, e-receipt, feedback page). */
  qr(data: string, options: QrOptions = {}): this {
    this.setWidths('auto');
    const cell = Math.min(8, Math.max(3, Math.round(options.cell ?? 6)));
    this.lines.push(`{code:${escapeValue(data)}; option:qrcode,${cell},${options.level ?? 'm'}}`);
    if (options.caption) this.center(options.caption);
    return this;
  }

  /** A barcode (order number, loyalty card). */
  barcode(data: string, options: BarcodeOptions = {}): this {
    this.setWidths('auto');
    const width = Math.min(4, Math.max(2, Math.round(options.width ?? 2)));
    const height = Math.min(240, Math.max(24, Math.round(options.height ?? 72)));
    this.lines.push(`{code:${escapeValue(data)}; option:${options.type ?? 'code128'},${width},${height},${options.hri === false ? 'nohri' : 'hri'}}`);
    return this;
  }

  /** A logo: a PNG as base64 (no `data:` prefix), ideally black and white. */
  image(pngBase64: string): this {
    this.setWidths('auto');
    this.lines.push(`{image:${pngBase64.replace(/^data:image\/png;base64,/, '')}}`);
    return this;
  }

  /** Cut the paper here (the bridge also cuts at the end, per printer settings). */
  cut(): this {
    this.setWidths('auto');
    this.lines.push('=');
    return this;
  }

  /** Any ReceiptLine you write yourself, added as is. */
  raw(receiptLine: string): this {
    this.lines.push(...receiptLine.split(/\r?\n/));
    this.widths = 'unknown';
    return this;
  }

  /** The ReceiptLine document. */
  toString(): string {
    return this.lines.join('\n');
  }
}

/** Start a receipt: `receipt().title('My Shop').row('Total', '9.00').toString()`. */
export function receipt(): Receipt {
  return new Receipt();
}
