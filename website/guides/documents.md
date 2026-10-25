# A4 invoices & HTML pages

For full-page invoices, quotes and reports, send an HTML page to an A4/A5
printer. It's printed through the printer's own driver as sharp vector text.

## A4 / A5 documents

```http
POST /print/document
```

| Field | Type | Notes |
| --- | --- | --- |
| `html` *or* `pdfBase64` | string | A complete HTML page, or a base64 PDF (macOS/Linux only for now) |
| `printer` | string | API name, e.g. `"invoice"`. Default: the default A4 printer |
| `paperSize` | string | `A4`, `A5`, `Letter` or `Legal`. Default: the printer's setting |
| `landscape` | boolean | Default `false` |
| `copies` | 1–20 | Default `1` |
| `title` | string | Shown in the printer queue, e.g. `"Invoice INV-1042"` |

```js
await fetch('http://127.0.0.1:9191/print/document', {
  method: 'POST',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    printer: 'invoice',
    paperSize: 'A4',
    title: 'Invoice INV-1042',
    html: `<!doctype html><html><head><meta charset="utf-8"><style>
             @page { margin: 15mm; } body { font-family: Arial, sans-serif; }
           </style></head><body><h1>Invoice INV-1042</h1>…</body></html>`,
  }),
});
```

### Tips for invoice HTML

- **Send one self-contained page.** Put CSS in a `<style>` tag and embed logos
  as `data:` URLs. Pages render with **no network access**.
- **JavaScript is turned off.** Render the final HTML in your POS (a template
  engine, React `renderToString`…) before sending it.
- **QR codes:** generate them in the POS (e.g. with the `qrcode` npm package)
  and embed them as inline `<svg>` or a `data:` image.
- Set margins with `@page { margin: 15mm; }`, and use
  `page-break-inside: avoid` on table rows so long invoices break cleanly.

!!! tip "A4 without writing HTML"
    Send a [receipt](receipts.md) to an A4 printer (`"printer": "invoice"`) and
    the bridge lays the same lines out as a page.

## HTML bills on a thermal printer

```http
POST /print/page
```

```json
{ "html": "<!doctype html>…", "format": "80mm", "printer": "receipt", "copies": 1, "title": "Bill #1042" }
```

Prints a page your POS designed for a receipt roll. `format` is the paper the
page was laid out for: `80mm`, `58mm`, `a4` or `a5`. How a thermal printer
prints it depends on its **Print bills** setting:

- **Printer driver** — the page goes through the printer maker's driver, at
  the printer's full resolution, on a page exactly as long as the bill. Needs
  the maker's driver installed (not *Generic / Text Only*).
- **Direct** — the page is rendered to a black-and-white image at the print
  head's width. Works on any printer, but text is less sharp.
- **Auto** (default) — the driver when the printer has one, otherwise direct.

!!! warning "Prefer line-by-line receipts"
    HTML on a thermal printer is never as sharp, small or reliable as a
    [line-by-line receipt](receipts.md). Use `/print/page` only when you must
    reproduce an exact design, such as a logo-heavy layout.

## ReceiptLine

```http
POST /print/receiptline
```

```json
{ "document": "^^^My Shop\nBill | #1042\n-\n^^TOTAL | ^^LKR 1,250.00", "printer": "receipt", "copies": 1, "cut": true }
```

[ReceiptLine](https://github.com/receiptline/receiptline) is an open "Markdown
for receipts" with barcodes, logos and tables. The bridge prints it with the
printer's own fonts, laid out for the printer's width and character set.
`POST /preview/receiptline` with the same body returns `{ svg, cpl, printer }`
to show on screen. The SDK builds ReceiptLine with `receipt()` — see
[SDK](../sdk.md#receiptline-receipts-alternative).
