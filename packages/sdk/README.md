# pos-hardware-bridge

Print sharp receipts from **any POS** (web, Node or Electron) on any ESC/POS or
Star thermal printer, kitchen printer or A4 printer, through
[POS Hardware Bridge](https://github.com/Thisarahetz/pos-hardware-bridge).

📖 **Documentation:** https://thisarahetz.github.io/pos-hardware-bridge/

```bash
npm install pos-hardware-bridge
```

```js
import { BridgeClient, ReceiptBuilder } from 'pos-hardware-bridge';

const bridge = new BridgeClient({ token: '<access token from the bridge settings>' });

const bill = new ReceiptBuilder()
  .center('MY SHOP', { bold: true, size: 'large' })
  .center('12 Main St · 077 123 4567')
  .banner('PAID')
  .rule()
  .row('Bill', '#1042')
  .row('Date', '25 Oct 2026 10:41')
  .rule()
  .item({ name: 'Latte', qty: 2, unitPrice: '4.50', total: '9.00', notes: ['Oat milk'] })
  .item({ name: 'Croissant', qty: 1, total: '3.50' })
  .rule('double')
  .total('TOTAL', 'LKR 1,250.00')
  .qr('https://myshop.example/r/1042', 'Scan for your e-receipt')
  .center('Thank you!', { bold: true });

await bridge.printReceipt(bill);                        // default receipt printer
await bridge.printReceipt(bill, { printer: 'kitchen' }); // a named printer
```

No dependencies, typed, works with `import` and `require`. React apps also get a
ready-made printer settings widget from `pos-hardware-bridge/react`.

---

## Receipts, line by line

A receipt is a list of lines (`blocks`): `text`, `row`, `rule`, `qr` and
`feed`. The bridge prints each line with the **printer's own commands and
fonts** — nothing is turned into HTML, a PDF or a picture — and wraps text to
the paper: 32 characters on 58mm, 42 or 48 on 80mm. The same receipt prints
correctly on every paper width.

| `ReceiptBuilder` method | Prints |
| --- | --- |
| `text(text, options?)` | Text, wrapped at word boundaries. `options`: `align`, `bold`, `underline`, `invert`, `size`, `indent` |
| `center(text, options?)` | Centred text |
| `row(left, right, options?)` | Label left, value right; a long label wraps beside the value |
| `item({ name, total, qty?, unitPrice?, notes? })` | `2 x Latte ..... 9.00`, then unit price and notes indented |
| `total(label, value, { emphasis? })` | A bold, double-height total (`emphasis: false` for a plain row) |
| `banner(text)` | White-on-black label, e.g. `PAID`, `REPRINT` |
| `rule(style?)` | `-----` (`single`) or `=====` (`double`) across the paper |
| `qr(data, label?, size?)` | A centred QR code (`small`/`medium`/`large`) |
| `feed(lines?)` | Blank lines |
| `build()` | `{ blocks }` — send it with `printReceipt()`, or in a print job |

Sizes: `normal`, `wide` (double width), `tall` (double height), `large` (both).

### Preview exactly what prints

`layoutReceipt(blocks, columns)` is the bridge's own layout code. It returns
the lines exactly as the printer prints them, so your on-screen preview always
matches the paper:

```js
import { layoutReceipt } from 'pos-hardware-bridge';

const columns = (await bridge.printers()).find((p) => p.id === 'receipt')?.paperWidthChars ?? 42;
for (const line of layoutReceipt(bill.build().blocks, columns)) {
  if (line.kind === 'line') console.log(line.text);   // also: align, bold, size, invert
  if (line.kind === 'qr') console.log(`[QR ${line.data}]`);
}
```

**Rules every POS should follow**

1. **Format money yourself** and pass strings (`'LKR 1,250.00'`): the bridge
   prints what you send.
2. **Don't assume a paper width** or pad with spaces — use `row()` and `rule()`.
3. **Keep the right-hand values short** (amounts, dates, references).
4. **Leave the cut to the bridge.** Each printer's settings decide full cut,
   partial cut or tear-off feed.
5. **Pick printers by API name** (`receipt`, `kitchen`, `invoice`), not by
   device. The shop maps names to printers in the bridge.

## ReceiptLine receipts (alternative)

The SDK can also write **[ReceiptLine](https://github.com/receiptline/receiptline)**
documents (an open "Markdown for receipts"), which add barcodes and logos.
Build them with `receipt()` and print with `bridge.print()`:

```js
import { receipt } from 'pos-hardware-bridge';

await bridge.print(
  receipt().title('My Shop').row('Bill', '#1042').barcode('1042', { type: 'code128' }),
);
```

### Building ReceiptLine receipts

| Method | Prints |
| --- | --- |
| `title(text, size?)` | Big bold centred heading (default `large` = 2×) |
| `center(text, style?)` | Centred text |
| `text(text, style?)` | A line of text; `style`: `align`, `bold`, `underline`, `invert`, `size`, `indent` |
| `banner(text)` | White-on-black label, e.g. `TAX INVOICE`, `REPRINT` |
| `row(label, value, style?)` | Label left, value right |
| `item({ name, total, qty?, unitPrice?, notes? })` | An item line, with unit price and notes underneath |
| `total(label, value, { emphasis? })` | A totals row; `emphasis` = bold, double height |
| `divider()` | A full-width rule |
| `qr(data, { cell?, level?, caption? })` | A QR code |
| `barcode(data, { type?, width?, height?, hri? })` | A barcode (`code128` by default) |
| `image(pngBase64)` | A logo |
| `feed(lines?)` | Blank lines |
| `cut()` | Cut here |
| `raw(receiptLine)` | Your own ReceiptLine |
| `toString()` | The ReceiptLine document |

Sizes: `normal`, `wide` (double width), `tall` (double height), `large` (2×),
`xlarge` (3×). Special characters such as `| { } - = ~ _ " ^` are escaped
for you, so `Coca-Cola | 50%` prints as written.

## Talking to the bridge

```js
const bridge = new BridgeClient({
  url: 'http://127.0.0.1:9191', // default
  token: '…',                   // bridge settings → Connect your POS
});
```

| Method | Does |
| --- | --- |
| `printReceipt(receipt, { printer?, copies?, cut?, title? })` | Print a line-by-line receipt (`ReceiptBuilder` or `{ blocks }`) |
| `print(receipt, { printer?, copies?, cut?, title? })` | Print a ReceiptLine receipt |
| `preview(receipt, { printer? })` | `{ svg, cpl }`: a ReceiptLine receipt as it will print, for your screen |
| `printDocument({ html } \| { pdfBase64 }, { printer?, paperSize?, landscape?, copies? })` | Print an A4/A5 invoice |
| `printPage(html, { printer?, format?, copies?, title? })` | Print a ready-made HTML bill |
| `printTestPage(printer?)` | The bridge's test page |
| `printers()` | Printers with API names and live status |
| `status()` | Plain-language status to show the cashier |
| `health()` | Is the bridge running? Its `id` and `name` (no token needed) |
| `me()` | `{ kind: 'local' }` on the printer computer, or the paired device's name |
| `BridgeClient.pair({ url, code, name })` | Pair a phone/tablet/till; returns `{ url, token }` to save |
| `onStatus(listener)` | Live updates (printer unplugged, back online); returns `stop()` |

Errors are `BridgeError`s whose `message` is written for the cashier (*"The
receipt printer is not connected. Check the cable…"*). `status` holds the HTTP
code, `details` lists bad fields, and `unreachable` is `true` when the bridge
isn't running.

```js
try {
  await bridge.printReceipt(bill);
} catch (err) {
  showToast(err.message);              // already cashier-friendly
  if (err.unreachable) offerBrowserPrint();
}
```

### A printer menu, with no printer settings in your POS

The bridge owns the printer setup. Your POS just lists what's there:

```js
const printers = await bridge.printers();
// [{ id: 'receipt', name: 'Front counter', kind: 'receipt', isDefault: true, ready: true, status: {…} }, …]
const choices = printers.map((p) => ({ value: p.id, label: `${p.name}${p.ready ? '' : ` (${p.status?.title})`}` }));
await bridge.printReceipt(bill, { printer: chosenId }); // or leave printer out for the default
```

### Printing from tablets and phones

**On the shop Wi-Fi:** the shop opens *Connect your POS → Phones & tablets* in the
bridge, turns it on and clicks *Get a code*. Your app pairs once and saves the result:

```js
const { url, token } = await BridgeClient.pair({
  url: 'http://192.168.1.20:9191', // shown in the bridge's Phones & tablets tab
  code: '482 913',                 // shown after "Get a code"
  name: 'Kitchen tablet',
});
const bridge = new BridgeClient({ url, token });
```

Paired devices can print and read status, not take card payments. Native
apps can find bridges with mDNS (`_pos-bridge._tcp`). A web page served over
`https://` can't call a local `http://` address, so for a hosted web POS use:

**Through your backend (any network):** implement the
[print station protocol](https://github.com/Thisarahetz/pos-hardware-bridge/blob/master/docs/print-station.openapi.yaml)
on your server, pair the bridge with it once, and queue the same receipt
(`bill.build()`) as a print job's `receipt`.

Full API reference: [openapi.yaml](https://github.com/Thisarahetz/pos-hardware-bridge/blob/master/docs/openapi.yaml),
or `http://127.0.0.1:9191/docs` on any computer running the bridge.

## React printer widget

A ready-made **Printers** settings page and a status badge for your POS header.
They save the settings on the device, so your code only prints by role:

```tsx
import { PrinterSettings, PrinterStatusBadge } from 'pos-hardware-bridge/react';
import { printFor } from 'pos-hardware-bridge';

<PrinterSettings />                                  // Settings → Printers
<PrinterStatusBadge onClick={openPrinterSettings} /> // 'Printers ready', 'Kitchen: Out of paper'

const result = await printFor('receipt', bill);     // never throws
if (!result.ok && !result.skipped) showReprint(result.message);
```

React 17+ (optional peer dependency). Custom roles, props, hooks
(`usePrintSettings`, `usePrinterStatus`) and styling:
[React printer widget guide](https://thisarahetz.github.io/pos-hardware-bridge/guides/react-widget/).


## License

MIT. ReceiptLine is © Open Foodservice System Consortium / OpenReceipt
Project, Apache-2.0.
