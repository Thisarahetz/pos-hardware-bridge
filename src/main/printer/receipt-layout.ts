/**
 * Receipt layout — SHARED FILE. The bridge prints exactly the lines this
 * produces, and POS apps preview exactly the same lines, so a preview always
 * matches the paper. Identical copies (CI checks they match):
 *   - src/main/printer/receipt-layout.ts   the bridge (source of truth)
 *   - packages/sdk/src/layout.ts            the `pos-hardware-bridge` npm package
 * It has no imports, so it can be copied into any TypeScript project as is.
 *
 * A receipt is a list of blocks (text, row, rule, qr, image, feed). `layoutReceipt`
 * turns them into lines exactly `width` characters wide (32 on 58mm paper,
 * 42 or 48 on 80mm), wrapping text at word boundaries.
 */

/** wide = double width, tall = double height, large = both. */
export type ReceiptTextSize = 'normal' | 'wide' | 'tall' | 'large';

export type ReceiptBlock =
  /** Text, wrapped at word boundaries to the paper's width. */
  | {
      type: 'text';
      text: string;
      align?: 'left' | 'center' | 'right';
      bold?: boolean;
      underline?: boolean;
      /** White on black, e.g. a "PAID" banner. */
      invert?: boolean;
      size?: ReceiptTextSize;
      /** Leading spaces, for lines under an item (0–8). */
      indent?: number;
    }
  /** Label on the left, value on the right; a long label wraps beside the value. */
  | { type: 'row'; left: string; right: string; bold?: boolean; size?: ReceiptTextSize; indent?: number }
  /** A line across the paper: ----- or =====. */
  | { type: 'rule'; style?: 'single' | 'double' }
  /** A QR code, centred, with an optional caption under it. */
  | { type: 'qr'; data: string; label?: string; size?: 'small' | 'medium' | 'large' }
  /** A logo or picture (PNG or JPEG as base64), centred and scaled to the paper. */
  | { type: 'image'; data: string; size?: ReceiptImageSize }
  /** Blank lines (1–10). */
  | { type: 'feed'; lines?: number };

/** Share of the paper width a picture fills: small 40%, medium 60%, large 80%, full 100%. */
export type ReceiptImageSize = 'small' | 'medium' | 'large' | 'full';

/** A receipt as a list of lines, printed top to bottom. */
export interface ReceiptDocument {
  blocks: ReceiptBlock[];
}

/** One laid-out line (or a QR code / blank space), ready to print or draw. */
export type ReceiptLayoutItem =
  | {
      kind: 'line';
      /** Exactly as printed; for wide/large text, in double-width characters. */
      text: string;
      align: 'left' | 'center' | 'right';
      bold: boolean;
      underline: boolean;
      invert: boolean;
      size: ReceiptTextSize;
    }
  | { kind: 'qr'; data: string; label?: string; size: 'small' | 'medium' | 'large' }
  | { kind: 'image'; data: string; size: ReceiptImageSize }
  | { kind: 'feed'; lines: number };

/** How many normal characters wide / lines tall each text size is. */
export const RECEIPT_TEXT_SCALE: Record<ReceiptTextSize, { w: number; h: number }> = {
  normal: { w: 1, h: 1 },
  wide: { w: 2, h: 1 },
  tall: { w: 1, h: 2 },
  large: { w: 2, h: 2 },
};

/** Characters receipt code pages often lack, as plain equivalents. */
export function cleanReceiptText(text: string): string {
  return String(text)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[‐-―−]/g, '-')
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”‟]/g, '"')
    .replace(/×/g, 'x')
    .replace(/[·•]/g, '-')
    .replace(/…/g, '...')
    .replace(/₨/g, 'Rs')
    .replace(/[  ]/g, ' ');
}

const len = (s: string) => [...s].length;

/** Word-wrap to `width` characters; words longer than a line are split. */
export function wrapReceiptText(text: string, width: number): string[] {
  const max = Math.max(1, width);
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ').filter(Boolean)) {
    let w = word;
    while (len(w) > max) {
      if (line) {
        lines.push(line);
        line = '';
      }
      lines.push([...w].slice(0, max).join(''));
      w = [...w].slice(max).join('');
    }
    if (!w) continue;
    if (!line) line = w;
    else if (len(line) + 1 + len(w) <= max) line += ` ${w}`;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line || lines.length === 0) lines.push(line);
  return lines;
}

/** Lay the blocks out as lines `width` normal characters wide. */
export function layoutReceipt(blocks: ReceiptBlock[], width: number): ReceiptLayoutItem[] {
  const out: ReceiptLayoutItem[] = [];
  for (const b of blocks) {
    if (b.type === 'rule') {
      const text = (b.style === 'double' ? '=' : '-').repeat(width);
      out.push({ kind: 'line', text, align: 'left', bold: false, underline: false, invert: false, size: 'normal' });
      continue;
    }
    if (b.type === 'qr') {
      out.push({ kind: 'qr', data: b.data, label: b.label ? cleanReceiptText(b.label) : undefined, size: b.size ?? 'medium' });
      continue;
    }
    if (b.type === 'image') {
      out.push({ kind: 'image', data: b.data, size: b.size ?? 'medium' });
      continue;
    }
    if (b.type === 'feed') {
      out.push({ kind: 'feed', lines: Math.max(1, Math.min(b.lines ?? 1, 10)) });
      continue;
    }
    const size = b.size ?? 'normal';
    const cols = Math.max(4, Math.floor(width / RECEIPT_TEXT_SCALE[size].w));
    const indent = ' '.repeat(Math.min(b.indent ?? 0, Math.floor(cols / 3)));
    const style = {
      bold: Boolean(b.bold),
      underline: b.type === 'text' && Boolean(b.underline),
      invert: b.type === 'text' && Boolean(b.invert),
      size,
    };
    const push = (text: string, align: 'left' | 'center' | 'right' = 'left') => out.push({ kind: 'line', text, align, ...style });

    if (b.type === 'text') {
      const align = b.align ?? 'left';
      for (const line of wrapReceiptText(cleanReceiptText(b.text), cols - indent.length)) {
        push(align === 'left' ? indent + line : line, align);
      }
      continue;
    }

    // Row: the value keeps its own column on the right; the label wraps beside it.
    const left = cleanReceiptText(b.left).trim();
    const right = cleanReceiptText(b.right).trim();
    const leftCols = cols - indent.length - len(right) - 1;
    if (leftCols < 6) {
      for (const line of wrapReceiptText(left, cols - indent.length)) push(indent + line);
      push(right.padStart(cols));
      continue;
    }
    wrapReceiptText(left, leftCols).forEach((line, i) => {
      push(i === 0 ? indent + line + ' '.repeat(leftCols - len(line) + 1) + right : indent + line);
    });
  }
  return out;
}
