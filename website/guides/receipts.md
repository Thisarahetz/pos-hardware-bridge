# Receipts, line by line

The recommended way to print on thermal printers. Your POS sends the receipt
as a list of lines (`blocks`); the bridge prints each line with the
**printer's own commands and fonts**.

- **Sharp** — the printer's fonts, never a blurry picture.
- **Fits the paper** — the bridge wraps text for the printer: 32 characters on
  58mm, 42 or 48 on 80mm. One receipt prints correctly on every printer.
- **Small and fast** — a few KB per receipt.
- **Works everywhere** — any ESC/POS or Star printer, USB or network.

```http
POST /print/receipt
Authorization: Bearer <token>
Content-Type: application/json

{ "printer": "receipt", "blocks": [ … ] }
```

## Line types

| `type` | Fields | Prints as |
| --- | --- | --- |
| `text` | `text`, `align` (`left`/`center`/`right`), `bold`, `underline`, `invert`, `size`, `indent` (0–8) | Text, wrapped at word boundaries |
| `row` | `left`, `right`, `bold`, `size`, `indent` | `Subtotal          40.00` — `right` stays on the right; a long `left` wraps beside it |
| `rule` | `style`: `single` or `double` | `--------` or `========` across the paper |
| `qr` | `data`, `label`, `size` (`small`/`medium`/`large`) | A centred QR code with a caption under it |
| `image` | `data` (base64 PNG/JPEG), `size` (`small`/`medium`/`large`/`full`) | A centred logo, printed in black and white |
| `feed` | `lines` (1–10) | Blank lines |

- **`size`**: `normal`, `wide` (double width), `tall` (double height) or
  `large` (both). Wide and large text fit half as many characters per line.
- **`invert`**: white on black — good for a `PAID` or `REPRINT` banner.

Other fields on the request: `printer` (API name; default receipt printer if
left out), `copies` (1–5), `cut` (`false` to leave the paper uncut) and
`title` (shown in the printer queue). Up to 600 lines.

## A complete bill

```json
{
  "title": "Bill #1042",
  "blocks": [
    { "type": "text", "text": "DEMO COFFEE", "align": "center", "bold": true, "size": "large" },
    { "type": "text", "text": "12 Main St · 077 123 4567", "align": "center" },
    { "type": "feed" },
    { "type": "text", "text": " PAID ", "align": "center", "bold": true, "invert": true },
    { "type": "rule" },
    { "type": "row", "left": "Bill", "right": "#1042", "bold": true },
    { "type": "row", "left": "Date", "right": "25 Oct 2026, 10:41" },
    { "type": "row", "left": "Table", "right": "7" },
    { "type": "rule" },
    { "type": "row", "left": "2 x Flat white with an extra shot", "right": "9.00", "bold": true },
    { "type": "text", "text": "Oat milk", "indent": 2 },
    { "type": "text", "text": "4.50 ea", "indent": 2 },
    { "type": "row", "left": "1 x Croissant", "right": "3.50", "bold": true },
    { "type": "rule" },
    { "type": "row", "left": "Subtotal", "right": "12.50" },
    { "type": "row", "left": "Service (10%)", "right": "1.25" },
    { "type": "rule", "style": "double" },
    { "type": "row", "left": "TOTAL", "right": "LKR 1,375.00", "bold": true, "size": "tall" },
    { "type": "row", "left": "Cash", "right": "1,500.00" },
    { "type": "row", "left": "Change", "right": "125.00" },
    { "type": "rule" },
    { "type": "qr", "data": "https://demo.example/r/1042", "label": "Scan for your e-receipt" },
    { "type": "feed" },
    { "type": "text", "text": "Thank you, come again!", "align": "center", "bold": true }
  ]
}
```

It prints like this (laid out by the bridge's own code):

=== "80mm paper (42 characters)"

    ```text
              D E M O   C O F F E E             ← double size
            12 Main St - 077 123 4567

                       PAID                     ← white on black
    ------------------------------------------
    Bill                                 #1042
    Date                    25 Oct 2026, 10:41
    Table                                    7
    ------------------------------------------
    2 x Flat white with an extra shot     9.00
      Oat milk
      4.50 ea
    1 x Croissant                         3.50
    ------------------------------------------
    Subtotal                             12.50
    Service (10%)                         1.25
    ==========================================
    TOTAL                         LKR 1,375.00  ← double height
    Cash                              1,500.00
    Change                              125.00
    ------------------------------------------
                   [ QR code ]
             Scan for your e-receipt

              Thank you, come again!
    ```

=== "58mm paper (32 characters)"

    ```text
         D E M O   C O F F E E        ← double size
       12 Main St - 077 123 4567

                  PAID                ← white on black
    --------------------------------
    Bill                       #1042
    Date          25 Oct 2026, 10:41
    Table                          7
    --------------------------------
    2 x Flat white with an      9.00
    extra shot
      Oat milk
      4.50 ea
    1 x Croissant               3.50
    --------------------------------
    Subtotal                   12.50
    Service (10%)               1.25
    ================================
    TOTAL               LKR 1,375.00  ← double height
    Cash                    1,500.00
    Change                    125.00
    --------------------------------
              [ QR code ]
        Scan for your e-receipt

         Thank you, come again!
    ```

Same request, both papers: the long item name wraps on 58mm and every amount
stays on the right.

## Building receipts with the SDK

The [SDK](../sdk.md) builds the blocks for you:

```js
import { BridgeClient, ReceiptBuilder } from 'pos-hardware-bridge';

const bill = new ReceiptBuilder()
  .center('DEMO COFFEE', { bold: true, size: 'large' })
  .center('12 Main St · 077 123 4567')
  .feed()
  .banner('PAID')
  .rule()
  .row('Bill', '#1042', { bold: true })
  .row('Date', '25 Oct 2026, 10:41')
  .rule()
  .item({ name: 'Flat white with an extra shot', qty: 2, total: '9.00', unitPrice: '4.50', notes: ['Oat milk'] })
  .item({ name: 'Croissant', qty: 1, total: '3.50' })
  .rule('double')
  .total('TOTAL', 'LKR 1,375.00')
  .qr('https://demo.example/r/1042', 'Scan for your e-receipt')
  .center('Thank you, come again!', { bold: true });

await new BridgeClient({ token }).printReceipt(bill, { title: 'Bill #1042' });
```

Any receipt — a kitchen ticket, refund slip, shift report — is a few calls:

```js
const ticket = new ReceiptBuilder()
  .center('KITCHEN', { bold: true, size: 'large' })
  .banner('TABLE 7')
  .row('Order', '#1042', { bold: true })
  .rule()
  .text('2 x Flat white', { bold: true, size: 'tall' })
  .text('Note: oat milk', { indent: 2 })
  .feed(2);

await bridge.printReceipt(ticket, { printer: 'kitchen' });
```

## Previews that match the paper

`layoutReceipt(blocks, columns)` in the SDK is **the bridge's own layout
code**. It returns each line exactly as the printer will print it — same
wrapping, same columns — so your on-screen preview always matches the paper.

```js
import { layoutReceipt } from 'pos-hardware-bridge';

const printer = (await bridge.printers()).find((p) => p.id === 'receipt');
const lines = layoutReceipt(bill.build().blocks, printer?.paperWidthChars ?? 42);
// [{ kind: 'line', text: '               DEMO COFFEE', align: 'center', bold: true, size: 'large', … },
//  { kind: 'qr', data: 'https://…', label: 'Scan for your e-receipt', size: 'medium' }, …]
```

Draw each `line` in a monospace font, `columns` characters wide (`wide`/`large`
lines are `columns / 2` characters drawn at double width). Not using
JavaScript? The layout file, `src/main/printer/receipt-layout.ts`, has no
imports and is short enough to port.

## Writing receipts that print well

- **Format money yourself** and send strings (`"LKR 1,375.00"`). The bridge
  prints what you send and does no maths.
- **Never pad with spaces or draw lines with `-`.** Use `row` and `rule`; the
  bridge knows the paper width, your POS doesn't.
- **Keep `right` short** — amounts, dates, references (max 60 characters).
- **Use plain text.** The bridge replaces `– — × · …` and curly quotes with
  plain equivalents. Other symbols depend on the printer's
  [character set](printers.md#settings).
- **Keep `wide`/`large` text for short headings** — 16 characters on 58mm.
- **QR codes: short links** (max 1,000 characters). Long content makes dense
  codes that are hard to scan.
- **Logos: `image` blocks.** Send a PNG or JPEG as base64 (a `data:` URL also
  works, max about 300 KB). The bridge scales it to a share of the paper width
  (`small` 40%, `medium` 60%, `large` 80%, `full` 100%; 384 dots on 58mm, 576
  on 80mm) and prints it black and white: transparent areas become white and
  grey is cut at 50%. Use a high-contrast logo, already close to the printed
  size, and encode it once rather than on every sale.

  ```json
  { "type": "image", "data": "iVBORw0KGgo…", "size": "medium" }
  ```

  ```js
  new ReceiptBuilder().image(logoBase64, 'medium').center('MY SHOP', { bold: true })
  ```
- **Leave the cut and final feed to the bridge.** Each printer's settings
  decide full cut, partial cut or tear-off.

## Other formats

- **Fixed receipt** — `POST /print/receipt` also accepts the original body
  with `businessName`, `lines`, `totalAmount`… (money in minor units). See the
  [API reference](../reference/index.html).
- **ReceiptLine** — `POST /print/receiptline` prints a
  [ReceiptLine](https://github.com/receiptline/receiptline) document, which
  adds barcodes and logos. See [A4 invoices & HTML pages](documents.md#receiptline).
