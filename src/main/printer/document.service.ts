import { app, BrowserWindow } from 'electron';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { DocumentPaperSize, PrinterProfile, ReceiptModel } from '../types';
import { ensureQueueReady } from './availability';
import { printSandbox } from './print-sandbox';
import { normalizeQr, qrSvg } from './qr';

export interface DocumentOptions {
  docName: string;
  paperSize?: DocumentPaperSize;
  landscape?: boolean;
  copies?: number;
}

const LOAD_TIMEOUT_MS = 20000;

export function money(amountMinorUnits: number, currency: string): string {
  return `${(amountMinorUnits / 100).toFixed(2)} ${currency}`;
}

function systemQueue(profile: PrinterProfile): string {
  if (profile.connection.type !== 'system') {
    throw new Error(
      `“${profile.name}” is connected by IP address and can only print receipts. To print pages on it, add it in the computer’s printer settings first.`,
    );
  }
  return profile.connection.queueName;
}

async function withTempFile<T>(ext: string, contents: string | Buffer, fn: (file: string) => Promise<T>): Promise<T> {
  const file = path.join(app.getPath('temp'), `pos-bridge-${randomUUID()}${ext}`);
  await fs.writeFile(file, contents);
  try {
    return await fn(file);
  } finally {
    await fs.rm(file, { force: true });
  }
}

/** Load an HTML page in a hidden, script-free window and run `use` on it. */
async function withPage<T>(html: string, use: (win: BrowserWindow) => Promise<T>): Promise<T> {
  return withTempFile('.html', html, async (file) => {
    const win = new BrowserWindow({
      show: false,
      width: 900,
      height: 1200,
      webPreferences: { javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false, ...printSandbox() },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event) => event.preventDefault());
    try {
      await Promise.race([
        win.loadFile(file),
        new Promise((_, reject) => setTimeout(() => reject(new Error('The document took too long to load')), LOAD_TIMEOUT_MS)),
      ]);
      return await use(win);
    } finally {
      win.destroy();
    }
  });
}

/** Print an HTML page silently on an A4/A5 (or any installed) printer.
 * Scripts are disabled; the page is laid out exactly as Chromium prints it. */
export async function printHtml(profile: PrinterProfile, html: string, options: DocumentOptions): Promise<void> {
  const queueName = systemQueue(profile);
  await ensureQueueReady(queueName);
  const pageSize = options.paperSize ?? profile.paperSize;
  const landscape = options.landscape ?? false;

  if (process.platform !== 'win32') {
    // macOS/Linux: render to PDF ourselves and hand it to CUPS. Going through
    // Chromium's print dialog code instead relies on a printer list cached for
    // the life of the process, which misses printers added after startup.
    const pdf = await withPage(html, (win) => win.webContents.printToPDF({ pageSize, landscape, printBackground: true }));
    await sendPdfToCups(queueName, pdf, { ...options, paperSize: pageSize, landscape: false });
    return;
  }

  await withPage(html, (win) =>
    new Promise<void>((resolve, reject) => {
      win.webContents.print(
        {
          silent: true,
          deviceName: queueName,
          printBackground: true,
          pageSize,
          landscape,
          copies: options.copies ?? 1,
          margins: { marginType: 'default' },
        },
        (success, reason) => (success ? resolve() : reject(new Error(`Printing failed (${reason})`))),
      );
    }),
  );
}

function sendPdfToCups(queueName: string, pdf: Buffer, options: DocumentOptions): Promise<void> {
  return withTempFile('.pdf', pdf, (file) => {
    const args = ['-d', queueName, '-t', options.docName, '-n', String(options.copies ?? 1)];
    if (options.paperSize) args.push('-o', `media=${options.paperSize}`);
    if (options.landscape) args.push('-o', 'landscape');
    args.push(file);
    return new Promise<void>((resolve, reject) => {
      execFile('lp', args, { timeout: 30000 }, (err, _stdout, stderr) =>
        err ? reject(new Error(String(stderr || err.message).trim())) : resolve(),
      );
    });
  });
}

/** Print a PDF file. macOS/Linux hand it to CUPS, which prints PDFs natively. */
export async function printPdf(profile: PrinterProfile, pdf: Buffer, options: DocumentOptions): Promise<void> {
  const queueName = systemQueue(profile);
  if (process.platform === 'win32') {
    throw new Error('PDF printing is not available on Windows yet. Send the document as HTML instead.');
  }
  if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new Error('The file sent in "pdfBase64" is not a PDF.');
  }
  await ensureQueueReady(queueName);
  await sendPdfToCups(queueName, pdf, { ...options, paperSize: options.paperSize ?? profile.paperSize });
}

// ---------- built-in pages ----------

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

const PAGE_STYLE = `
  @page { margin: 15mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; font-size: 11pt; color: #111; margin: 0; }
  h1 { font-size: 20pt; margin: 0 0 2mm; }
  .muted { color: #666; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111; padding-bottom: 4mm; margin-bottom: 6mm; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 2.5mm 2mm; text-align: left; border-bottom: 1px solid #ddd; }
  th { font-size: 9pt; text-transform: uppercase; letter-spacing: .04em; color: #555; }
  .num { text-align: right; white-space: nowrap; }
  .totals { width: 45%; margin-left: auto; margin-top: 4mm; }
  .totals td { border: 0; padding: 1.5mm 2mm; }
  .grand td { font-size: 13pt; font-weight: 700; border-top: 2px solid #111; }
  .foot { margin-top: 10mm; text-align: center; }
  .qr { margin-top: 8mm; text-align: center; }
  .qr svg { display: block; margin: 0 auto 2mm; }
  .qr.small svg { width: 25mm; } .qr.medium svg { width: 32mm; } .qr.large svg { width: 42mm; }
`;

/** The receipt laid out as a page, for when a receipt is sent to an A4/A5 printer. */
export async function receiptHtml(r: ReceiptModel): Promise<string> {
  const qr = r.qrCode ? normalizeQr(r.qrCode) : null;
  const qrBlock = qr
    ? `<div class="qr ${qr.size}">${await qrSvg(qr.data)}${qr.label ? `<div class="muted">${escapeHtml(qr.label)}</div>` : ''}</div>`
    : '';
  const rows = r.lines
    .map(
      (l) => `<tr>
        <td>${escapeHtml(l.label)}</td>
        <td class="num">${l.qty ?? 1}</td>
        <td class="num">${l.unitAmount !== undefined ? money(l.unitAmount, r.currency) : ''}</td>
        <td class="num">${money(l.totalAmount, r.currency)}</td>
      </tr>`,
    )
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(r.saleReference)}</title><style>${PAGE_STYLE}</style></head>
<body>
  <div class="head">
    <div><h1>${escapeHtml(r.businessName)}</h1>${r.locationName ? `<div class="muted">${escapeHtml(r.locationName)}</div>` : ''}</div>
    <div class="num"><strong>${escapeHtml(r.saleReference)}</strong><div class="muted">${escapeHtml(r.timestamp)}</div></div>
  </div>
  <table>
    <thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Unit price</th><th class="num">Amount</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <table class="totals">
    <tr><td>Subtotal</td><td class="num">${money(r.subtotalAmount, r.currency)}</td></tr>
    <tr><td>Tax</td><td class="num">${money(r.taxAmount, r.currency)}</td></tr>
    <tr class="grand"><td>Total</td><td class="num">${money(r.totalAmount, r.currency)}</td></tr>
    <tr><td class="muted">Paid by</td><td class="num muted">${escapeHtml(r.paymentMethod)}</td></tr>
  </table>
  ${qrBlock}
  ${r.footer ? `<p class="foot">${escapeHtml(r.footer)}</p>` : ''}
</body></html>`;
}

/** Test page for A4/A5 printers: a sample invoice showing margins and layout. */
export function testPageHtml(profile: PrinterProfile): Promise<string> {
  return receiptHtml({
    businessName: 'POS Hardware Bridge – test page',
    locationName: `Printer: ${profile.name} · API name: ${profile.id} · Paper: ${profile.paperSize}`,
    saleReference: 'TEST-0001',
    timestamp: new Date().toLocaleString(),
    lines: [
      { label: 'Sample item with a longer description', qty: 2, unitAmount: 1250, totalAmount: 2500 },
      { label: 'Another item', qty: 1, unitAmount: 990, totalAmount: 990 },
    ],
    subtotalAmount: 3490,
    taxAmount: 349,
    totalAmount: 3839,
    currency: 'USD',
    paymentMethod: 'Test',
    qrCode: { data: 'POS Hardware Bridge: QR test OK', label: 'Scan me to test QR codes' },
    footer: 'If this page looks right, A4 invoices from your POS will print correctly.',
  });
}
