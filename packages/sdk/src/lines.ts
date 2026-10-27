/**
 * Build receipts line by line — the recommended way to print on thermal
 * printers. The bridge prints each line with the printer's own commands and
 * fonts (no HTML, PDF or picture), wrapping text to the paper's width, so the
 * same receipt prints correctly on 58mm and 80mm paper.
 *
 * ```ts
 * const bill = new ReceiptBuilder()
 *   .center('MY SHOP', { bold: true, size: 'large' })
 *   .rule()
 *   .item({ name: 'Latte', qty: 2, total: '9.00', notes: ['Oat milk'] })
 *   .rule('double')
 *   .total('TOTAL', '9.00')
 *   .qr('https://myshop.example/r/1042', 'Scan for your e-receipt')
 *   .build();
 * await bridge.printReceipt(bill);
 * ```
 */

import type { ReceiptBlock, ReceiptDocument } from './layout.js';

export type TextBlockOptions = Omit<Extract<ReceiptBlock, { type: 'text' }>, 'type' | 'text'>;
export type RowBlockOptions = Omit<Extract<ReceiptBlock, { type: 'row' }>, 'type' | 'left' | 'right'>;

export interface ReceiptItem {
  /** Item name, e.g. "Latte (large)". */
  name: string;
  /** Line total, already formatted, e.g. "9.00" or "Rs 1,250.00". */
  total: string;
  /** Quantity; printed as "2 x Latte". */
  qty?: number | string;
  /** Price per unit, formatted; printed under the item as "4.50 ea". */
  unitPrice?: string;
  /** Extra lines under the item: options, notes, discounts. */
  notes?: string[];
}

export class ReceiptBuilder {
  private readonly blocks: ReceiptBlock[] = [];

  /** Text, wrapped at word boundaries to the paper's width. */
  text(text: string, options: TextBlockOptions = {}): this {
    this.blocks.push({ type: 'text', text, ...options });
    return this;
  }

  /** Centred text. */
  center(text: string, options: Omit<TextBlockOptions, 'align'> = {}): this {
    return this.text(text, { ...options, align: 'center' });
  }

  /** Label on the left, value on the right; a long label wraps beside the value. */
  row(left: string, right: string, options: RowBlockOptions = {}): this {
    this.blocks.push({ type: 'row', left, right, ...options });
    return this;
  }

  /** A white-on-black heading, e.g. PAID. */
  banner(text: string): this {
    return this.text(` ${text} `, { align: 'center', bold: true, invert: true });
  }

  /** An item: "2 x Latte ....... 9.00", then its unit price and notes indented. */
  item(item: ReceiptItem): this {
    const name = item.qty !== undefined && item.qty !== '' ? `${item.qty} x ${item.name}` : item.name;
    this.row(name, item.total, { bold: true });
    if (item.unitPrice) this.text(`${item.unitPrice} ea`, { indent: 2 });
    for (const note of item.notes ?? []) this.text(note, { indent: 2 });
    return this;
  }

  /** A total line; bold and double height unless `emphasis: false`. */
  total(label: string, value: string, options: { emphasis?: boolean } = {}): this {
    return options.emphasis === false ? this.row(label, value) : this.row(label, value, { bold: true, size: 'tall' });
  }

  /** A line across the paper: ----- (single) or ===== (double). */
  rule(style: 'single' | 'double' = 'single'): this {
    this.blocks.push({ type: 'rule', style });
    return this;
  }

  /** A centred QR code with an optional caption. Keep `data` short (a link). */
  qr(data: string, label?: string, size: 'small' | 'medium' | 'large' = 'medium'): this {
    this.blocks.push({ type: 'qr', data, label, size });
    return this;
  }

  /**
   * A centred logo: a PNG or JPEG as base64 (a `data:` URL works too). The bridge
   * scales it to the paper and prints it black and white, so use a high-contrast
   * logo. `size` is the share of the paper width: small 40%, medium 60%, large 80%, full 100%.
   */
  image(data: string, size: 'small' | 'medium' | 'large' | 'full' = 'medium'): this {
    this.blocks.push({ type: 'image', data, size });
    return this;
  }

  /** Blank lines (1–10). */
  feed(lines = 1): this {
    this.blocks.push({ type: 'feed', lines });
    return this;
  }

  /** The receipt, ready for `bridge.printReceipt()` or a print job's `receipt` field. */
  build(): ReceiptDocument {
    return { blocks: [...this.blocks] };
  }
}
