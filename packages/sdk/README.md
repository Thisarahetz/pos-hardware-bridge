# pos-hardware-bridge

Print sharp, correctly sized receipts from **any POS** (web, Node or Electron)
on any ESC/POS or Star thermal printer, kitchen printer or A4 printer, through
[POS Hardware Bridge](https://github.com/Thisarahetz/pos-hardware-bridge).

```bash
npm install pos-hardware-bridge
```

```js
import { BridgeClient, receipt } from 'pos-hardware-bridge';

const bridge = new BridgeClient({ token: '<access token from the bridge settings>' });

const bill = receipt()
  .title('My Shop')
  .center('12 Main St · 077 123 4567')
  .divider()
  .row('Bill', '#1042')
  .row('Date', '25 Oct 2026 10:41')
  .divider()
  .item({ name: 'Latte', qty: 2, unitPrice: '4.50', total: '9.00', notes: ['Oat milk'] })
  .item({ name: 'Croissant', qty: 1, total: '3.50' })
  .divider()
  .total('Subtotal', '12.50')
  .total('TOTAL', 'LKR 1,250.00', { emphasis: true })
  .qr('https://myshop.example/r/1042', { caption: 'Scan for your e-receipt' })
  .center('Thank you!', { bold: true });

await bridge.print(bill);                        // default receipt printer
await bridge.print(bill, { printer: 'kitchen' }); // a named printer
```

No dependencies, 7 KB, typed, works with `import` and `require`.

---

## The receipt document guideline

Every receipt is a **[ReceiptLine](https://github.com/receiptline/receiptline)**
document: an open, documented "Markdown for receipts" (Apache-2.0). This SDK
writes it for you; you can also write it by hand or in any language.

Why this format, and not an image or HTML page of the bill:

| | ReceiptLine (this SDK) | A picture / HTML of the bill |
| --- | --- | --- |
| Sharpness | Printer's own fonts, crisp | Blurry edges, thin text |
| Size on 58mm paper | Laid out for 32 columns | An 80mm design shrunk down |
| Data sent | ~2–5 KB | 50–500 KB |
| Speed | Instant | Rendering first |
| Same output on every brand | Yes (ESC/POS, Epson, Star, Citizen…) | Depends on the driver |

**Rules every POS should follow**

1. **Format money yourself** and pass strings (`'LKR 1,250.00'`): the bridge
   prints what you send.
2. **Don't assume a paper width.** The builder sizes columns relative to the
   line, so one receipt prints right on 58mm (32 characters), 80mm (42/48)
   and A4.
3. **Put values on the right with `row()` / `total()`.** The value's column is
   sized to fit it, so dates and amounts never wrap.
4. **Keep it to text, rules, QR codes and barcodes.** Use `image()` only for a
   small black-and-white logo.
5. **Leave the cut to the bridge.** Each printer's settings decide full cut,
   partial cut or tear-off feed. Use `cut()` only between tickets in one job.
6. **Pick printers by API name** (`receipt`, `kitchen`, `invoice`), not by
   device. The shop maps names to printers in the bridge.

## Building receipts

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
| `print(receipt, { printer?, copies?, cut?, title? })` | Print a receipt |
| `preview(receipt, { printer? })` | `{ svg, cpl }`: the receipt exactly as it will print, for your screen |
| `printDocument({ html } \| { pdfBase64 }, { printer?, paperSize?, landscape?, copies? })` | Print an A4/A5 invoice |
| `printTestPage(printer?)` | The bridge's test page |
| `printers()` | Printers with API names and live status |
| `status()` | Plain-language status to show the cashier |
| `health()` | Is the bridge running? (no token needed) |
| `onStatus(listener)` | Live updates (printer unplugged, back online); returns `stop()` |

Errors are `BridgeError`s whose `message` is written for the cashier (*"The
receipt printer is not connected. Check the cable…"*). `status` holds the HTTP
code, `details` lists bad fields, and `unreachable` is `true` when the bridge
isn't running.

```js
try {
  await bridge.print(bill);
} catch (err) {
  showToast(err.message);              // already cashier-friendly
  if (err.unreachable) offerBrowserPrint();
}
```

### Printing from tablets and phones

A browser can only reach a bridge on its own computer. To print from other
devices, pair the bridge with your backend as a *print station*, and send
the same ReceiptLine document as a print job. See the
[bridge README](https://github.com/Thisarahetz/pos-hardware-bridge#print-from-any-pos-device-ai-pos).

## License

MIT. ReceiptLine is © Open Foodservice System Consortium / OpenReceipt
Project, Apache-2.0.
