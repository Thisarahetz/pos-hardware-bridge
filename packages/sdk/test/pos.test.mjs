// The POS helpers (saved settings, print per role, status) and the React
// widgets in pos-hardware-bridge/react.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import {
  ReceiptBuilder,
  connectToBridge,
  defaultPrintSettings,
  loadPrintSettings,
  printFor,
  savePrintSettings,
  summarizeStatus,
} from '../dist/esm/index.js';
import { PrinterSettings, PrinterStatusBadge } from '../dist/esm/react/index.js';

// A localStorage for Node.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

async function withFetch(handler, fn) {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : undefined });
    const [status, body] = handler(url, init);
    return new Response(JSON.stringify(body), { status });
  };
  try {
    await fn(calls);
  } finally {
    globalThis.fetch = realFetch;
  }
}

const bill = () => new ReceiptBuilder().text('Thank you');

test('settings start with the defaults and survive a reload', () => {
  store.clear();
  assert.deepEqual(loadPrintSettings(), defaultPrintSettings());
  assert.equal(loadPrintSettings().printers.kitchen, null); // kitchen is off until chosen

  savePrintSettings({ ...defaultPrintSettings(), token: 'abc', printers: { receipt: 'front' } });
  const loaded = loadPrintSettings();
  assert.equal(loaded.token, 'abc');
  assert.equal(loaded.printers.receipt, 'front');
  assert.equal(loaded.printers.invoice, ''); // missing roles fall back to their default

  store.set('pos-hardware-bridge.settings', '{not json');
  assert.deepEqual(loadPrintSettings(), defaultPrintSettings());
});

test('custom roles and storage keys', () => {
  store.clear();
  const roles = [{ id: 'bar', label: 'Bar tickets', kind: 'receipt', defaultPrinter: null }];
  assert.deepEqual(loadPrintSettings({ roles }).printers, { bar: null });
  savePrintSettings({ ...defaultPrintSettings(roles), token: 'x' }, { storageKey: 'till-2' });
  assert.equal(loadPrintSettings({ storageKey: 'till-2' }).token, 'x');
  assert.equal(loadPrintSettings().token, '');
});

test('printFor prints to the chosen printer, skips when off, and never throws', async () => {
  store.clear();
  assert.deepEqual(await printFor('receipt', bill()), { ok: false, skipped: true }); // not set up

  savePrintSettings({ ...defaultPrintSettings(), token: 't0ken', copies: 2, printers: { receipt: 'front', kitchen: null } });
  assert.deepEqual(await printFor('kitchen', bill()), { ok: false, skipped: true }); // "Don't print"

  await withFetch(() => [200, { ok: true, printer: 'front' }], async (calls) => {
    assert.deepEqual(await printFor('receipt', bill(), { title: 'Bill #7' }), { ok: true, printer: 'front' });
    assert.equal(calls[0].url, 'http://127.0.0.1:9191/print/receipt');
    assert.equal(calls[0].body.printer, 'front');
    assert.equal(calls[0].body.copies, 2);
    assert.equal(calls[0].body.title, 'Bill #7');
  });

  await withFetch(() => [503, { error: 'The receipt printer is out of paper.' }], async () => {
    assert.deepEqual(await printFor('receipt', bill()), {
      ok: false,
      message: 'The receipt printer is out of paper.',
      canRetry: true,
    });
  });

  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError('fetch failed');
  };
  try {
    const result = await printFor('receipt', bill());
    assert.equal(result.ok, false);
    assert.equal(result.canRetry, false); // no answer: it may have printed
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('connectToBridge checks the bridge, the token and loads printers', async () => {
  const printers = [{ id: 'front', name: 'Front counter', kind: 'receipt', isDefault: true, ready: true }];
  await withFetch(
    (url) =>
      url.endsWith('/health')
        ? [200, { ok: true, bridge: { name: 'Front desk PC', version: '1.0.0' }, printers: [] }]
        : url.endsWith('/me')
          ? [200, { kind: 'local' }]
          : [200, printers],
    async () => {
      const connection = await connectToBridge('http://127.0.0.1:9191', 'tok');
      assert.equal(connection.bridgeName, 'Front desk PC');
      assert.equal(connection.kind, 'local');
      assert.deepEqual(connection.printers, printers);
    },
  );
  await withFetch(
    (url) => (url.endsWith('/health') ? [200, { ok: true }] : [401, {}]),
    async () => {
      await assert.rejects(connectToBridge('http://127.0.0.1:9191', 'wrong'), /did not accept this device/);
    },
  );
});

test('the status summary shows the worst printer first', () => {
  const p = (name, level, title) => ({ name, level, title, steps: [] });
  assert.equal(summarizeStatus({ printers: [] }).light, 'warning');
  assert.deepEqual(summarizeStatus({ printers: [p('Front', 'ok', 'Ready')] }), { light: 'ok', text: 'Printers ready', steps: [] });
  const s = summarizeStatus({ printers: [p('Front', 'warning', 'Paper low'), p('Kitchen', 'error', 'Out of paper')] });
  assert.equal(s.light, 'error');
  assert.equal(s.text, 'Kitchen: Out of paper');
});

test('<PrinterSettings /> shows the connect step until it is set up', () => {
  store.clear();
  const html = renderToString(createElement(PrinterSettings));
  assert.match(html, /<h2>Printers<\/h2>/);
  assert.match(html, /1\. Connect to POS Hardware Bridge/);
  assert.match(html, /Access token/);
  assert.doesNotMatch(html, /Choose printers/);
  assert.match(html, /<style/);

  const plain = renderToString(createElement(PrinterSettings, { title: null, unstyled: true }));
  assert.doesNotMatch(plain, /<h2>|<style/);
});

test('<PrinterStatusBadge /> renders before the first status arrives', () => {
  const html = renderToString(createElement(PrinterStatusBadge));
  assert.match(html, /Checking printers/);
  assert.match(html, /data-light="off"/);
  assert.match(renderToString(createElement(PrinterStatusBadge, { onClick: () => {} })), /^<button/);
});
