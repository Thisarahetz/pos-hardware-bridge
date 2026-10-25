// Line-by-line receipts: the builder makes the blocks the bridge prints, and
// layoutReceipt lays them out exactly as the bridge does on 58mm and 80mm.
import assert from 'node:assert/strict';
import test from 'node:test';
import { BridgeClient, ReceiptBuilder, layoutReceipt } from '../dist/esm/index.js';

const bill = () =>
  new ReceiptBuilder()
    .center('Demo Coffee', { bold: true, size: 'large' })
    .banner('PAID')
    .rule()
    .row('Bill', '#1042')
    .item({ name: 'Flat white with an extra shot of espresso', qty: 2, total: '$9.00', unitPrice: '$4.50', notes: ['Oat milk'] })
    .rule('double')
    .total('TOTAL', '$9.00')
    .qr('https://demo.example/r/1042', 'Scan for your e-receipt')
    .feed()
    .center('Thank you – come again!');

const textLines = (items) => items.filter((i) => i.kind === 'line').map((i) => i.text);

test('builds the blocks the bridge prints', () => {
  const { blocks } = bill().build();
  assert.deepEqual(blocks[0], { type: 'text', text: 'Demo Coffee', bold: true, size: 'large', align: 'center' });
  assert.deepEqual(blocks[1], { type: 'text', text: ' PAID ', align: 'center', bold: true, invert: true });
  assert.ok(blocks.some((b) => b.type === 'qr' && b.data === 'https://demo.example/r/1042'));
  assert.ok(blocks.some((b) => b.type === 'row' && b.left === 'TOTAL' && b.size === 'tall'));
});

for (const width of [32, 42, 48]) {
  test(`every line fits ${width} columns, and values stay on the right`, () => {
    const items = layoutReceipt(bill().build().blocks, width);
    for (const item of items) {
      if (item.kind !== 'line') continue;
      const cols = item.size === 'large' || item.size === 'wide' ? width / 2 : width;
      assert.ok([...item.text].length <= cols, `"${item.text}" is longer than ${cols}`);
    }
    const lines = textLines(items);
    const bill1042 = lines.find((l) => l.startsWith('Bill'));
    assert.equal(bill1042.length, width);
    assert.ok(bill1042.endsWith('#1042'));
    assert.ok(lines.some((l) => l.startsWith('2 x Flat white') && l.endsWith('$9.00')), 'item total on the first line');
    assert.equal(lines.find((l) => l.startsWith('-')), '-'.repeat(width));
    assert.equal(lines.find((l) => l.startsWith('=')), '='.repeat(width));
  });
}

test('replaces characters receipt printers lack', () => {
  const lines = textLines(layoutReceipt([{ type: 'text', text: 'Thank you – come again! 2×3 · “ok”…' }], 42));
  assert.deepEqual(lines, ['Thank you - come again! 2x3 - "ok"...']);
});

test('printReceipt sends the blocks to POST /print/receipt', async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ ok: true, printer: 'kitchen' }), { status: 200 });
  };
  try {
    const bridge = new BridgeClient({ token: 't0ken' });
    const result = await bridge.printReceipt(bill(), { printer: 'kitchen', copies: 2 });
    assert.deepEqual(result, { ok: true, printer: 'kitchen' });
    assert.equal(calls[0].url, 'http://127.0.0.1:9191/print/receipt');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer t0ken');
    const body = JSON.parse(calls[0].init.body);
    assert.deepEqual(body.blocks, bill().build().blocks);
    assert.equal(body.printer, 'kitchen');
    assert.equal(body.copies, 2);
  } finally {
    globalThis.fetch = realFetch;
  }
});
