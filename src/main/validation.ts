import type { DocumentPaperSize, ReceiptDocument, ReceiptModel, TerminalChargeRequest } from './types';

/** Returns a list of problems with a request body; empty means it's valid. */
type Check = (body: Record<string, unknown>) => string[];

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isText = (v: unknown) => typeof v === 'string' && v.trim().length > 0;
const isMinorUnits = (v: unknown) => Number.isInteger(v);

function requireText(body: Record<string, unknown>, field: string, problems: string[]): void {
  if (!isText(body[field])) problems.push(`"${field}" is required and must be a non-empty string`);
}

function requireMoney(body: Record<string, unknown>, field: string, problems: string[]): void {
  if (!isMinorUnits(body[field])) {
    problems.push(`"${field}" must be a whole number in minor units (e.g. 12.50 → 1250)`);
  }
}

const PAPER_SIZES = ['A4', 'A5', 'Letter', 'Legal'];

function checkPrinterName(body: Record<string, unknown>, problems: string[]): void {
  if (body.printer !== undefined && !isText(body.printer)) {
    problems.push('"printer" must be the printer’s API name (e.g. "receipt" or "invoice") when given');
  }
}

const checkReceipt: Check = (body) => {
  const problems: string[] = [];
  checkPrinterName(body, problems);
  if (body.cut !== undefined && typeof body.cut !== 'boolean') problems.push('"cut" must be true or false when given');
  requireText(body, 'businessName', problems);
  requireText(body, 'saleReference', problems);
  requireText(body, 'timestamp', problems);
  requireText(body, 'paymentMethod', problems);
  if (!(typeof body.currency === 'string' && /^[A-Za-z]{3}$/.test(body.currency))) {
    problems.push('"currency" must be a 3-letter code such as "USD" or "LKR"');
  }
  requireMoney(body, 'subtotalAmount', problems);
  requireMoney(body, 'taxAmount', problems);
  requireMoney(body, 'totalAmount', problems);
  if (body.qrCode !== undefined) {
    const qr = body.qrCode;
    const data = typeof qr === 'string' ? qr : isObject(qr) ? qr.data : undefined;
    if (!isText(data)) {
      problems.push('"qrCode" must be a non-empty string, or an object like { "data": "https://…", "label": "Scan to pay" }');
    } else if ((data as string).length > 1000) {
      problems.push('"qrCode" content is too long to scan reliably (max 1000 characters; use a short link)');
    }
    if (isObject(qr)) {
      if (qr.label !== undefined && typeof qr.label !== 'string') problems.push('"qrCode.label" must be a string when given');
      if (qr.size !== undefined && !['small', 'medium', 'large'].includes(qr.size as string)) {
        problems.push('"qrCode.size" must be "small", "medium" or "large"');
      }
    }
  }
  for (const optional of ['locationName', 'footer'] as const) {
    if (body[optional] !== undefined && typeof body[optional] !== 'string') {
      problems.push(`"${optional}" must be a string when given`);
    }
  }

  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    problems.push('"lines" must be a non-empty array of items');
  } else {
    body.lines.forEach((line, i) => {
      if (!isObject(line)) {
        problems.push(`lines[${i}] must be an object`);
        return;
      }
      if (!isText(line.label)) problems.push(`lines[${i}].label is required`);
      if (!isMinorUnits(line.totalAmount)) problems.push(`lines[${i}].totalAmount must be a whole number in minor units`);
      if (line.qty !== undefined && !(Number.isInteger(line.qty) && (line.qty as number) > 0)) {
        problems.push(`lines[${i}].qty must be a positive whole number when given`);
      }
      if (line.unitAmount !== undefined && !isMinorUnits(line.unitAmount)) {
        problems.push(`lines[${i}].unitAmount must be a whole number in minor units when given`);
      }
    });
  }
  return problems;
};

const checkDocument: Check = (body) => {
  const problems: string[] = [];
  checkPrinterName(body, problems);
  const hasHtml = body.html !== undefined;
  const hasPdf = body.pdfBase64 !== undefined;
  if (hasHtml === hasPdf) problems.push('Send exactly one of "html" (an HTML page) or "pdfBase64" (a PDF file, base64-encoded)');
  if (hasHtml && !isText(body.html)) problems.push('"html" must be a non-empty string');
  if (hasPdf && !(typeof body.pdfBase64 === 'string' && /^[A-Za-z0-9+/=\s]+$/.test(body.pdfBase64) && body.pdfBase64.length > 0)) {
    problems.push('"pdfBase64" must be a base64-encoded PDF');
  } else if (hasPdf && Buffer.from((body.pdfBase64 as string).slice(0, 12), 'base64').toString('latin1').slice(0, 5) !== '%PDF-') {
    problems.push('"pdfBase64" does not contain a PDF file (it should start with %PDF-)');
  }
  if (body.title !== undefined && typeof body.title !== 'string') problems.push('"title" must be a string when given');
  if (body.paperSize !== undefined && !PAPER_SIZES.includes(body.paperSize as string)) {
    problems.push(`"paperSize" must be one of ${PAPER_SIZES.join(', ')}`);
  }
  if (body.landscape !== undefined && typeof body.landscape !== 'boolean') problems.push('"landscape" must be true or false');
  if (body.copies !== undefined && !(Number.isInteger(body.copies) && (body.copies as number) >= 1 && (body.copies as number) <= 20)) {
    problems.push('"copies" must be a whole number from 1 to 20');
  }
  return problems;
};

const checkCharge: Check = (body) => {
  const problems: string[] = [];
  if (!(Number.isInteger(body.amountMinorUnits) && (body.amountMinorUnits as number) > 0)) {
    problems.push('"amountMinorUnits" must be a positive whole number (e.g. 12.50 → 1250)');
  }
  if (!(typeof body.currency === 'string' && /^[A-Za-z]{3}$/.test(body.currency))) {
    problems.push('"currency" must be a 3-letter code such as "USD" or "LKR"');
  }
  requireText(body, 'reference', problems);
  return problems;
};

function validate<T>(body: unknown, check: Check): { ok: true; value: T } | { ok: false; problems: string[] } {
  if (!isObject(body)) {
    return { ok: false, problems: ['Request body must be a JSON object (send header "Content-Type: application/json")'] };
  }
  const problems = check(body);
  return problems.length ? { ok: false, problems } : { ok: true, value: body as T };
}

export interface DocumentRequest {
  printer?: string;
  html?: string;
  pdfBase64?: string;
  title?: string;
  paperSize?: DocumentPaperSize;
  landscape?: boolean;
  copies?: number;
}

export const validateReceipt = (body: unknown) => validate<ReceiptModel & { printer?: string; cut?: boolean }>(body, checkReceipt);
export const validateDocument = (body: unknown) => validate<DocumentRequest>(body, checkDocument);
export const validatePrinterChoice = (body: unknown) =>
  validate<{ printer?: string }>(body ?? {}, (b) => {
    const problems: string[] = [];
    checkPrinterName(b, problems);
    return problems;
  });
export interface PageRequest {
  html: string;
  printer?: string;
  format?: '80mm' | '58mm' | 'a4' | 'a5';
  copies?: number;
  title?: string;
}

export const validatePage = (body: unknown) =>
  validate<PageRequest>(body, (b) => {
    const problems: string[] = [];
    checkPrinterName(b, problems);
    if (!isText(b.html)) problems.push('"html" must be the page to print, as a complete HTML document');
    if (b.format !== undefined && !['80mm', '58mm', 'a4', 'a5'].includes(b.format as string)) {
      problems.push('"format" must be one of 80mm, 58mm, a4, a5');
    }
    if (b.copies !== undefined && !(Number.isInteger(b.copies) && (b.copies as number) >= 1 && (b.copies as number) <= 5)) {
      problems.push('"copies" must be a whole number from 1 to 5');
    }
    if (b.title !== undefined && typeof b.title !== 'string') problems.push('"title" must be a string when given');
    return problems;
  });

export interface ReceiptLineRequest {
  document: string;
  printer?: string;
  copies?: number;
  cut?: boolean;
  title?: string;
}

/** ReceiptLine documents: https://github.com/receiptline/receiptline#grammar */
export const validateReceiptLine = (body: unknown) =>
  validate<ReceiptLineRequest>(body, (b) => {
    const problems: string[] = [];
    checkPrinterName(b, problems);
    if (!isText(b.document)) {
      problems.push('"document" must be a ReceiptLine document (see https://github.com/receiptline/receiptline#grammar)');
    } else if ((b.document as string).length > 500_000) {
      problems.push('"document" is too large (max 500 KB; shrink embedded images)');
    }
    if (b.copies !== undefined && !(Number.isInteger(b.copies) && (b.copies as number) >= 1 && (b.copies as number) <= 5)) {
      problems.push('"copies" must be a whole number from 1 to 5');
    }
    if (b.cut !== undefined && typeof b.cut !== 'boolean') problems.push('"cut" must be true or false');
    if (b.title !== undefined && typeof b.title !== 'string') problems.push('"title" must be a string when given');
    return problems;
  });

export const MAX_RECEIPT_BLOCKS = 600;
const MAX_IMAGE_BASE64 = 400_000;
const BLOCK_TYPES = ['text', 'row', 'rule', 'qr', 'image', 'feed'];
const TEXT_SIZES = ['normal', 'wide', 'tall', 'large'];

/** Problems with a line-by-line receipt's "blocks"; empty means it's valid. */
export function checkBlocks(blocks: unknown): string[] {
  if (!Array.isArray(blocks) || blocks.length === 0) return ['"blocks" must be a non-empty array of receipt lines'];
  if (blocks.length > MAX_RECEIPT_BLOCKS) return [`"blocks" has too many lines (max ${MAX_RECEIPT_BLOCKS})`];
  const problems: string[] = [];
  const isStr = (v: unknown, max = 1000) => typeof v === 'string' && v.length <= max;
  blocks.forEach((b, i) => {
    const at = `blocks[${i}]`;
    if (!isObject(b) || !BLOCK_TYPES.includes(b.type as string)) {
      problems.push(`${at}.type must be one of ${BLOCK_TYPES.join(', ')}`);
      return;
    }
    if ((b.type === 'text' || b.type === 'row') && b.size !== undefined && !TEXT_SIZES.includes(b.size as string)) {
      problems.push(`${at}.size must be one of ${TEXT_SIZES.join(', ')}`);
    }
    if (b.indent !== undefined && !(Number.isInteger(b.indent) && (b.indent as number) >= 0 && (b.indent as number) <= 8)) {
      problems.push(`${at}.indent must be a whole number from 0 to 8`);
    }
    for (const flag of ['bold', 'underline', 'invert'] as const) {
      if (b[flag] !== undefined && typeof b[flag] !== 'boolean') problems.push(`${at}.${flag} must be true or false`);
    }
    switch (b.type) {
      case 'text':
        if (!isStr(b.text)) problems.push(`${at}.text must be a string (max 1000 characters)`);
        if (b.align !== undefined && !['left', 'center', 'right'].includes(b.align as string)) problems.push(`${at}.align must be left, center or right`);
        break;
      case 'row':
        if (!isStr(b.left, 500)) problems.push(`${at}.left must be a string (max 500 characters)`);
        if (!isStr(b.right, 60)) problems.push(`${at}.right must be a string (max 60 characters)`);
        break;
      case 'rule':
        if (b.style !== undefined && !['single', 'double'].includes(b.style as string)) problems.push(`${at}.style must be single or double`);
        break;
      case 'qr':
        if (!isText(b.data) || (b.data as string).length > 1000) problems.push(`${at}.data must be the QR content (max 1000 characters; use a short link)`);
        if (b.label !== undefined && !isStr(b.label, 200)) problems.push(`${at}.label must be a string`);
        if (b.size !== undefined && !['small', 'medium', 'large'].includes(b.size as string)) problems.push(`${at}.size must be small, medium or large`);
        break;
      case 'image':
        if (!isStr(b.data, MAX_IMAGE_BASE64) || !/^(data:image\/(png|jpe?g);base64,)?[A-Za-z0-9+/=\s]+$/.test(b.data as string)) {
          problems.push(`${at}.data must be a PNG or JPEG as base64 (max ${Math.round(MAX_IMAGE_BASE64 / 1000)} KB; shrink the logo)`);
        }
        if (b.size !== undefined && !['small', 'medium', 'large', 'full'].includes(b.size as string)) problems.push(`${at}.size must be small, medium, large or full`);
        break;
      case 'feed':
        if (b.lines !== undefined && !(Number.isInteger(b.lines) && (b.lines as number) >= 1 && (b.lines as number) <= 10)) {
          problems.push(`${at}.lines must be a whole number from 1 to 10`);
        }
        break;
    }
  });
  return problems;
}

export interface ReceiptBlocksRequest extends ReceiptDocument {
  printer?: string;
  cut?: boolean;
  copies?: number;
  title?: string;
}

export const validateReceiptBlocks = (body: unknown) =>
  validate<ReceiptBlocksRequest>(body, (b) => {
    const problems: string[] = [];
    checkPrinterName(b, problems);
    problems.push(...checkBlocks(b.blocks));
    if (b.copies !== undefined && !(Number.isInteger(b.copies) && (b.copies as number) >= 1 && (b.copies as number) <= 5)) {
      problems.push('"copies" must be a whole number from 1 to 5');
    }
    if (b.cut !== undefined && typeof b.cut !== 'boolean') problems.push('"cut" must be true or false');
    if (b.title !== undefined && typeof b.title !== 'string') problems.push('"title" must be a string when given');
    return problems;
  });

export const validateCharge = (body: unknown) => validate<TerminalChargeRequest>(body, checkCharge);
export const validateReference = (body: unknown) =>
  validate<{ reference: string }>(body, (b) => (isText(b.reference) ? [] : ['"reference" is required']));
