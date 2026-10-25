// Receipts built with the SDK must print the same on 58mm and 80mm paper,
// print special characters literally, and be valid ReceiptLine.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { escapeText, receipt } from '../dist/esm/index.js';

// ReceiptLine itself (installed in the bridge app) renders the documents here,
// as plain text, so the tests see exactly what the printer would print.
const require = createRequire(import.meta.url);
const receiptline = require('../../../node_modules/receiptline');
const asText = (doc, cpl) => receiptline.transform(String(doc), { cpl, command: 'text', encoding: 'multilingual' });
const linesOf = (out) => out.split('\n').map((l) => l.replace(/\s+$/, '')).filter(Boolean);

const bill = () =>
  receipt()
    .title('Demo Coffee')
    .center('12 Main St')
    .divider()
    .row('Date', '25 Oct 2026 10:41')
    .item({ name: 'Latte', qty: 2, unitPrice: '4.50', total: '9.00', notes: ['Oat milk'] })
    .divider()
    .total('TOTAL', 'LKR 1,250.00', { emphasis: true });

test('a value never wraps, on 58mm or 80mm paper', () => {
  for (const cpl of [32, 42, 48]) {
    const lines = linesOf(asText(bill(), cpl));
    assert.ok(lines.some((l) => l.startsWith('Date') && l.endsWith('25 Oct 2026 10:41')), `date on one line at ${cpl} cpl`);
    assert.ok(lines.every((l) => l.length <= cpl), `nothing wider than ${cpl}`);
  }
});

test('items show quantity, total, unit price and notes', () => {
  const lines = linesOf(asText(bill(), 32));
  assert.ok(lines.some((l) => /^2 x Latte\s+9\.00$/.test(l)));
  assert.ok(lines.some((l) => l.trim() === '2 x 4.50' && l.startsWith('  ')));
  assert.ok(lines.some((l) => l.trim() === 'Oat milk'));
});

test('special characters print literally', () => {
  const doc = receipt().text('Coca-Cola | 50% {promo} ~ "best" ^_^ = \\ `x`').toString();
  const out = linesOf(asText(doc, 48)).join('\n');
  assert.equal(out.trim(), 'Coca-Cola | 50% {promo} ~ "best" ^_^ = \\ `x`');
  assert.equal(escapeText('a|b'), 'a\\|b');
});

test('a lone "-" or "=" line is text, not a rule or a cut', () => {
  const doc = receipt().text('-').text('=').toString();
  assert.deepEqual(linesOf(asText(doc, 32)).map((l) => l.trim()), ['-', '=']);
});

test('alignment', () => {
  const lines = asText(receipt().text('L', { align: 'left' }).text('C', { align: 'center' }).text('R', { align: 'right' }), 31)
    .split('\n')
    .filter((l) => l.trim());
  assert.equal(lines[0].indexOf('L'), 0);
  assert.equal(lines[1].indexOf('C'), 15);
  assert.equal(lines[2].trimEnd().length, 31);
});

test('QR codes, barcodes, rules and cuts are valid ReceiptLine', () => {
  const doc = receipt()
    .qr('https://shop.example/r/1042?a=1;b=2', { caption: 'Scan me' })
    .barcode('1042', { hri: true })
    .divider()
    .cut()
    .toString();
  assert.match(doc, /\{code:https:\/\/shop\.example\/r\/1042\?a=1\\;b=2; option:qrcode,6,m\}/);
  assert.match(doc, /\{code:1042; option:code128,2,72,hri\}/);
  // Renders as printer commands without throwing.
  const escpos = receiptline.transform(doc, { cpl: 42, command: 'escpos', encoding: 'multilingual' });
  assert.ok(escpos.length > 100);
});
