# POS Hardware Bridge

A small tray app that lets any browser-based POS (GlowDesk, SmartPOS,
Restaurant POS, …) print receipts, print A4/A5 invoices and take card
payments on the computer it runs on. Browsers can't talk to USB printers or serial card terminals
directly, so the POS sends simple HTTP requests to this bridge on
`http://127.0.0.1:9191`, and the bridge drives the hardware.

- **Many printers on one computer** – thermal receipt printers (front
  counter, kitchen…) and office A4/A5 printers for invoices, side by side.
  The POS picks one by name, such as `"receipt"`, `"kitchen"` or `"invoice"`.
- **Plug and play** – a USB receipt printer is detected and set up
  automatically; network printers can be found with one click.
- **Clear status** – the tray icon and settings window show whether the
  printer is ready, and tell the cashier exactly what to do when it isn't.
- **Always on** – starts with the computer, stays in the tray, and recovers
  by itself after sleep, unplugging, or errors.
- **One printer computer for the whole shop** – phones, tablets and other
  tills print here too: over the shop Wi-Fi after pairing with a code, or from
  anywhere through your POS backend with the open
  [print station protocol](docs/print-station.openapi.yaml).
- **For any POS** – a documented API ([OpenAPI spec](docs/openapi.yaml), also
  served by the bridge at `http://127.0.0.1:9191/docs`) and an npm SDK
  ([`packages/sdk`](packages/sdk#readme)). The POS never configures printers.

---

## Contents

1. [Install (shop computer)](#install-shop-computer)
2. [First-time setup](#first-time-setup)
3. [Print from other devices](#print-from-other-devices)
4. [Connect your POS – quick start](#connect-your-pos--quick-start)
5. [API reference](#api-reference)
6. [Best practices for POS developers](#best-practices-for-pos-developers)
7. [Troubleshooting](#troubleshooting)
8. [Development](#development)
9. [Security notes](#security-notes)

---

## Install (shop computer)

**Windows 10/11**

1. Run `POS-Hardware-Bridge-Setup-<version>.exe`. It installs for the current
   user (no admin needed), adds desktop and Start-menu shortcuts, and starts the bridge.
2. If Windows SmartScreen warns about an unknown publisher, click
   **More info → Run anyway** (the installer isn't code-signed yet).

**macOS**

Open the `.dmg` and drag **POS Hardware Bridge** to Applications, then open it.

After installing, the bridge **starts automatically every time the computer
starts** and lives in the tray / menu bar. Closing the settings window does
not stop it. To turn auto-start off: tray icon → untick **Start with computer**.

## First-time setup

1. **Plug in the receipt printer** (USB) and turn it on. Within a few seconds
   you'll see *"Printer connected"* and the status turns green.
   - On Windows, if the printer has never been installed, click **Set up**
     next to it and choose **Yes** on the Windows permission prompt (once only).
   - Network printer? Click **Scan network**, or enter its IP under
     *Network printer by IP address* (port is usually `9100`).
2. Click **Test print** on the printer. The number line at the bottom should reach the
   right edge of the paper. If not, open **Settings** and change **Paper size** (58 mm / 80 mm).
   - **QR codes:** the test page includes a QR code. Scan it with a phone. If it's
     missing or garbled, set **QR codes** to **Print as image**.
   - **Paper cutter:** if the printer cuts the paper by itself, choose **Full cut** or
     **Partial cut** (partial leaves a small tab so the receipt doesn't fall). If the cashier
     tears receipts off by hand, choose **No cutter**. The bridge then feeds extra paper so no
     text is torn off. Adjust **Extra paper at the end** if needed.
3. **A4 printer for invoices (optional):** first install it the normal way
   (Windows: *Settings → Printers & scanners*; macOS: *System Settings →
   Printers & Scanners*). Then in the bridge, under **Add a printer**, click
   **Add as A4 printer** next to it, and use **Test print** to print a sample invoice.
4. **More receipt printers (optional)**, e.g. a kitchen printer: plug it in and click
   **Add as receipt printer**. Open its **Settings** to give it a clear name and API name
   (for example `kitchen`).
5. *(Optional)* Card terminal: tick **Use a card terminal**, pick its port,
   and click **Test $1.00 charge**.
6. Under **Connect your POS → On this computer**, copy the **Address** and
   **Password** (the access token) into your POS settings.

Each printer has an **API name** (shown on its card). The POS uses it to choose
the printer. The first printer of each type is the **default** for that type;
use **Make default** in a printer's settings to change it.

### What the status colours mean

| Tray dot | Meaning | What to do |
| --- | --- | --- |
| 🟢 green | Ready | Nothing |
| 🟡 yellow | Needs attention (paused, receipts stuck) | Open settings and use the button shown |
| 🔴 red | Printer unplugged / unreachable | Follow the steps shown in the settings window |
| ⚪ grey | Not set up / turned off | Plug in a printer or pick one |

---

## Print from other devices

Connect the printers to **one computer** and run the bridge there. Every
other device prints to it, and no POS needs any printer setup: it asks the
bridge for its printers (`GET /printers`) and prints to one by name.

| | Shop Wi-Fi | Print station (through your POS backend) |
| --- | --- | --- |
| Works for | Native, Electron, Android/iOS apps on the shop network | Every device, any network, including hosted web POS |
| Your POS needs | Nothing extra: call the bridge directly | Five backend routes ([protocol](docs/print-station.openapi.yaml)) |
| Setup at the shop | Turn on, pair each device with a code | Pair the printer computer once with a code |
| Card payments | No, printer computer only | No |

### Shop Wi-Fi: pair phones, tablets and tills

1. In the bridge, open **Connect your POS → Phones & tablets** and turn on
   **Let phones and tablets print here**.
   Allow the bridge if the firewall asks (Windows asks once).
2. Click **Get a code**. A 6-digit code appears, valid for 10 minutes and
   one device.
3. In the POS app on the device, enter the bridge address shown in the card
   (for example `http://192.168.1.20:9191`) and the code. The app calls
   `POST /pair` and saves the device token it gets back.

With the SDK:

```js
import { BridgeClient } from 'pos-hardware-bridge';

// Once, on the tablet:
const { url, token } = await BridgeClient.pair({ url: 'http://192.168.1.20:9191', code: '482 913', name: 'Kitchen tablet' });
// save url + token, then from now on:
const bridge = new BridgeClient({ url, token });
const printers = await bridge.printers(); // offer these in a "Print to…" menu
await bridge.print(bill, { printer: 'kitchen' });
```

Paired devices are listed in the bridge with when they were last used, and
can be renamed or removed at any time. Removing one cuts it off immediately.
A device token can print and read status; card payments only work from the
printer computer, and the computer's own access token is refused from the
network.

**Finding the bridge automatically:** it announces itself with mDNS/Bonjour
as `_pos-bridge._tcp` (TXT records `id`, `name`, `version`), so a native app
can list bridges on the network instead of asking for the address.
`GET /health` (no token) answers with the bridge's `id` and `name` too.

> **Hosted web POS:** a page served over `https://` can't call a plain
> `http://192.168.x.x` address (browsers block it as mixed content). Use the
> print station protocol below, or wrap the POS as a native/Electron app.

### Print station: any device, through your POS backend

Your POS backend queues print jobs; the bridge keeps one outgoing connection
to it and prints them. The printer computer needs no open ports or fixed IP,
and devices print from anywhere, even on mobile data.

To add this to **your** POS, implement the five routes in
[docs/print-station.openapi.yaml](docs/print-station.openapi.yaml): pair,
long-poll for jobs, report results, heartbeat with the printers, disconnect.
The spec spells out the rules that keep a bill from printing twice or late.
The shop then enters your server address and a code in the bridge's
**Connect your POS → With a code** tab. AI POS is a complete implementation of it.

### Print from any POS device (AI POS)

With AI POS, **every till, tablet and phone in the shop can print to the
printers on this computer**, even devices on mobile data. This computer
becomes the shop's *print station*: it holds one outgoing connection to AI
POS, so it needs no open ports, fixed IP address or router setup.

1. In AI POS, an owner or admin opens **Settings → Printers → Add print
   station**. It shows the POS address and a 6-digit code, valid for 10 minutes.
2. In the bridge, in the **AI POS · print from any device** card, enter that
   address, a name for this computer (for example *Front counter PC*) and the
   code, then click **Connect**.
3. The station appears in AI POS with its printers and a green dot. From then
   on, **Print bill** on any device prints here and shows *Printed ✓* or the
   printer's error.

How a bill prints on a thermal printer (bridge settings → printer → **Print bills**):
- **Printer driver** — the bill exactly as the POS designs it (logo, fonts,
  layout) goes through the printer maker's driver, which prints it sharp at
  the printer's full resolution, on a page exactly as long as the bill. Needs
  the maker's driver installed on this computer (not "Generic / Text Only").
- **Direct** — the bill as ReceiptLine text in the printer's own fonts. Works
  on any ESC/POS or Star printer, including ones reached by IP address.
- **Auto** (default) — the driver when the printer has one, otherwise direct.

A4/A5 bills go through the office printer's driver.

**Built so a bill never prints twice or late:**
- A print that isn't picked up within 2 minutes (for example, this computer is
  off) expires, and the cashier is offered **Print on this device** instead.
- If the connection drops after printing, the bill isn't printed again: the
  bridge remembers what it already printed.
- After sleep, a network change or an AI POS restart, the bridge reconnects by
  itself.

The station's key is kept in the computer's keychain (Windows DPAPI, macOS
Keychain) and never shown. **Disconnect** in the bridge, or **Remove** in AI
POS, revokes it immediately.

## Connect your POS – quick start

### Recommended: the SDK and ReceiptLine

Send receipts as **[ReceiptLine](https://github.com/receiptline/receiptline)**
documents (an open "Markdown for receipts" standard). The bridge prints them
with the printer's own fonts: sharp, correctly sized for 58mm and 80mm paper,
and a few KB per receipt. The **`pos-hardware-bridge`** npm package
([packages/sdk](packages/sdk#readme)) builds them for you:

```js
import { BridgeClient, receipt } from 'pos-hardware-bridge';

const bridge = new BridgeClient({ token: '<access token>' });
await bridge.print(
  receipt()
    .title('My Shop')
    .row('Bill', '#1042')
    .item({ name: 'Latte', qty: 2, total: '9.00' })
    .total('TOTAL', 'LKR 1,250.00', { emphasis: true })
    .qr('https://myshop.example/r/1042', { caption: 'Scan for your e-receipt' }),
);
```

Read the [receipt document guideline](packages/sdk#the-receipt-document-guideline)
before designing a bill. Use HTML (`/print/document`) only for A4/A5
invoices, which the driver prints as sharp vector text.

### Plain HTTP

Every request except `/health` needs the access token from the settings window:

```
Authorization: Bearer <access token>
```

Print a receipt (works from a browser or Node 18+):

```js
const BRIDGE_URL = 'http://127.0.0.1:9191';
const BRIDGE_TOKEN = '<access token from the bridge settings>';

async function printReceipt(sale) {
  const res = await fetch(`${BRIDGE_URL}/print/receipt`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${BRIDGE_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(sale),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error + (data.details ? ': ' + data.details.join('; ') : ''));
}

await printReceipt({
  businessName: 'My Shop',
  locationName: 'Main Street',
  saleReference: 'SALE-1042',
  timestamp: new Date().toLocaleString(),
  lines: [
    { label: 'Coffee', qty: 2, unitAmount: 350, totalAmount: 700 },
    { label: 'Croissant', totalAmount: 450 },
  ],
  subtotalAmount: 1150,
  taxAmount: 115,
  totalAmount: 1265,
  currency: 'USD',
  paymentMethod: 'Cash',
  footer: 'Thank you, come again!',
});
```

The same example, with your real address and token filled in, is in the
settings window under **Connect your POS → On this computer → For developers → Copy example**.

Or with curl:

```bash
curl -X POST http://127.0.0.1:9191/print/receipt \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"businessName":"My Shop","saleReference":"SALE-1042","timestamp":"24/10/2026 21:40",
       "lines":[{"label":"Coffee","qty":2,"totalAmount":700}],
       "subtotalAmount":700,"taxAmount":70,"totalAmount":770,"currency":"USD","paymentMethod":"Cash"}'
```

---

## API reference

The full, machine-readable reference is [docs/openapi.yaml](docs/openapi.yaml)
(OpenAPI 3); generate a client from it in any language. A running bridge also
serves it, with a readable viewer, at `http://127.0.0.1:9191/docs`.

Base URL: `http://127.0.0.1:<port>` (default port `9191`), or the address in
the **Phones & tablets** tab from a paired device. All request and
response bodies are JSON. **All money values are whole numbers in minor
units** (cents): `12.50` is sent as `1250`.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/health` | – | Is the bridge running? Are devices ready? Includes the bridge's `id` and `name` |
| `POST` | `/pair` | – | A device on the shop network swaps the 6-digit code for its own token |
| `GET` | `/me` | ✔ | Whether this token is the printer computer or a paired device |
| `GET` | `/docs` | – | This API reference in a browser (`/openapi.yaml` for the spec) |
| `GET` | `/status` | ✔ | Plain-language device status to show the cashier |
| `GET` | `/printers` | ✔ | All configured printers with their API names and status |
| `POST` | `/print/receiptline` | ✔ | **Recommended.** Print a ReceiptLine receipt with the printer's own fonts |
| `POST` | `/preview/receiptline` | ✔ | The same receipt as an SVG, exactly as it will print |
| `POST` | `/print/receipt` | ✔ | Print a receipt from structured JSON (thermal, or laid out on A4) |
| `POST` | `/print/document` | ✔ | Print an A4/A5 invoice or document (HTML or PDF) |
| `POST` | `/print/page` | ✔ | Print a ready-made HTML bill on any printer (through the printer's driver when it has one) |
| `POST` | `/print/test` | ✔ | Print a test page (`{"printer":"…"}` optional) |
| `POST` | `/terminal/charge` | ✔ local | Take a card payment (printer computer only) |
| `POST` | `/terminal/cancel` | ✔ | Cancel a payment in progress |
| `GET` | `/terminal/status` | ✔ | `{ "connected": boolean }` |
| `WS` | `/events?token=…` | ✔ | Live status and payment updates |

### `GET /health`

```json
{
  "ok": true, "printer": true, "terminal": false, "printerReady": true, "terminalReady": false,
  "printers": [
    { "id": "receipt", "kind": "receipt", "ready": true },
    { "id": "invoice", "kind": "document", "ready": true }
  ]
}
```

`printer` says whether any printer is set up, and `printerReady` whether the
default receipt printer is ready. `printers` lists every printer.

### `GET /printers`

```json
[
  {
    "id": "receipt", "name": "Front counter", "kind": "receipt", "isDefault": true,
    "paperWidthChars": 42, "ready": true,
    "status": { "level": "ok", "title": "Ready", "detail": "EPSON TM-T20 (USB)", "steps": [] }
  },
  {
    "id": "invoice", "name": "Office A4", "kind": "document", "isDefault": true,
    "paperSize": "A4", "ready": false,
    "status": { "level": "error", "title": "Printer disconnected", "detail": "HP LaserJet is unplugged or turned off.", "steps": ["Check the USB cable at both ends."] }
  }
]
```

`kind` is `receipt` (thermal) or `document` (A4/A5).

### `GET /status`

```json
{
  "printers": [
    { "id": "receipt", "name": "Front counter", "kind": "receipt", "level": "ok", "title": "Ready", "detail": "EPSON TM-T20 (USB)", "steps": [] }
  ],
  "printer": {
    "level": "error",
    "title": "Printer disconnected",
    "detail": "USB Portable Printer is unplugged or turned off.",
    "steps": ["Check the USB cable at both ends.", "Turn the printer on and wait for the light to stop blinking."]
  },
  "terminal": { "level": "off", "title": "Card terminal off", "detail": "Not used.", "steps": [] },
  "api": { "url": "http://127.0.0.1:9191", "running": true },
  "checkedAt": "2026-10-24T16:07:26.378Z"
}
```

`printers` has one entry per printer. `printer` summarises the default receipt
printer (kept for older integrations). `level` is `ok`, `warning`, `error` or `off`. `title`, `detail` and `steps`
are written for cashiers, so you can show them as they are.

### `POST /print/receipt`

**Line by line (recommended).** (Layout code shared with the POS preview: `src/main/printer/receipt-layout.ts`.) Send the receipt as a list of lines; the bridge
prints each one with the printer's own commands and fonts — nothing is turned
into HTML, a PDF or a picture — and wraps text to the paper (32 columns on
58mm, 42/48 on 80mm). This is what AI POS sends for bills.

```json
{
  "printer": "receipt",
  "blocks": [
    { "type": "text", "text": "MY SHOP", "align": "center", "bold": true, "size": "large" },
    { "type": "text", "text": " PAID ", "align": "center", "bold": true, "invert": true },
    { "type": "rule" },
    { "type": "row", "left": "2 x Latte", "right": "9.00", "bold": true },
    { "type": "text", "text": "Oat milk", "indent": 2 },
    { "type": "rule", "style": "double" },
    { "type": "row", "left": "TOTAL", "right": "9.00", "bold": true, "size": "tall" },
    { "type": "qr", "data": "https://shop.example/o/1042", "label": "Scan to view this bill" },
    { "type": "feed", "lines": 1 },
    { "type": "text", "text": "Thank you!", "align": "center" }
  ]
}
```

| Line `type` | Fields |
| --- | --- |
| `text` | `text`, `align` (`left`/`center`/`right`), `bold`, `underline`, `invert` (white on black), `size` (`normal`/`wide`/`tall`/`large`), `indent` (0–8) |
| `row` | `left`, `right` (kept on the right; a long `left` wraps beside it), `bold`, `size`, `indent` |
| `rule` | `style`: `single` (`-----`) or `double` (`=====`) |
| `qr` | `data`, `label` (caption under it), `size` (`small`/`medium`/`large`) — printed as set in the printer's **QR codes** setting |
| `feed` | `lines` (1–10) blank lines |

Also accepts `cut`, `copies` (1–5) and `title`. Up to 600 lines.

**Fixed receipt.** The original body below still works:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `printer` | string | | API name, e.g. `"kitchen"`. Defaults to the default receipt printer |
| `cut` | boolean | | `false` skips the cut, e.g. to print several tickets in a row. Default `true` |
| `businessName` | string | ✔ | Printed bold at the top |
| `locationName` | string | | Second header line |
| `saleReference` | string | ✔ | Your sale/order number |
| `timestamp` | string | ✔ | Printed as-is, so format it for the customer |
| `lines` | array | ✔ | At least one item (see below) |
| `lines[].label` | string | ✔ | Item name |
| `lines[].qty` | integer > 0 | | Printed as `2x` when above 1 |
| `lines[].unitAmount` | integer | | Unit price (minor units) |
| `lines[].totalAmount` | integer | ✔ | Line total (minor units) |
| `subtotalAmount` | integer | ✔ | Minor units |
| `taxAmount` | integer | ✔ | Minor units |
| `totalAmount` | integer | ✔ | Minor units |
| `currency` | string | ✔ | 3-letter code: `USD`, `LKR`, `EUR`… |
| `paymentMethod` | string | ✔ | e.g. `Cash`, `Card ****4242` |
| `qrCode` | string or object | | QR code printed above the footer (see below) |
| `footer` | string | | Printed centred at the bottom |

The bridge prints the totals you send and does no maths of its own, so
calculate them in the POS.

**QR codes**: for a payment link, e-invoice, order tracking or a feedback page.
Send just the content, or an object with a caption and size:

```json
"qrCode": "https://myshop.example/r/SALE-1042"
```
```json
"qrCode": { "data": "https://myshop.example/r/SALE-1042", "label": "Scan for your e-receipt", "size": "medium" }
```

`size` is `small`, `medium` (default) or `large`. Keep the content short
(a short link scans best on small receipts); the maximum is 1000 characters.
QR codes print on thermal and A4 printers alike.

Sending a receipt to an A4 printer (`"printer": "invoice"`) prints the same
data laid out as a page with an item table and totals. That's a quick way
to get A4 invoices without writing any HTML.

Response: `{ "ok": true, "printer": "receipt" }`, naming the printer that was used.

### `POST /print/receiptline`

```json
{ "document": "^^^My Shop\nBill | #1042\n-\n^^TOTAL | ^^LKR 1,250.00", "printer": "receipt", "copies": 1, "cut": true, "title": "Bill #1042" }
```

`document` is a [ReceiptLine](https://github.com/receiptline/receiptline#grammar)
document. It's laid out for the printer's own width (set by **Paper size** in its
settings) and printed in the printer's fonts, with the printer's **Character
set**. Feed and cut follow its cutter settings. On an A4/A5 printer it prints as
a centred receipt column. `POST /preview/receiptline` with the same body
returns `{ svg, cpl, printer }` for showing the receipt on screen.

### `POST /print/page`

Print a page laid out by the POS, the same way the AI POS print station does:
a thermal printer with its maker's driver installed prints it through that
driver (see **Print bills** above); one without renders it to an image at its
print head's width. An A4/A5 printer prints it through its driver.

```json
{ "html": "<!doctype html>…", "format": "80mm", "printer": "receipt", "copies": 1, "title": "Bill #1042" }
```

`format` is the paper the page was laid out for: `80mm`, `58mm`, `a4` or `a5`.
Thermal formats go to the default receipt printer and sheet formats to the
default document printer, unless you name a `printer`. The page renders with
scripts off and no network access, so put the CSS inline and embed images as
`data:` URLs.

### `POST /print/document`

Prints a page on an A4/A5 printer through its normal driver. Send **either**
`html` **or** `pdfBase64`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `printer` | string | | API name, e.g. `"invoice"`. Defaults to the default document printer |
| `html` | string | one of | A complete HTML page (see tips below) |
| `pdfBase64` | string | one of | A PDF file, base64-encoded. macOS/Linux only for now; on Windows send HTML |
| `paperSize` | string | | `A4`, `A5`, `Letter` or `Legal`. Defaults to the printer's setting |
| `landscape` | boolean | | Default `false` |
| `copies` | integer 1–20 | | Default `1` |
| `title` | string | | Job name shown in the printer queue, e.g. `"Invoice INV-1042"` |

```js
await fetch(`${BRIDGE_URL}/print/document`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${BRIDGE_TOKEN}`, 'Content-Type': 'application/json' },
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

**Tips for invoice HTML**

- Send **one self-contained page**: put CSS in a `<style>` tag, and embed
  logos as `data:` image URLs so nothing has to download.
- **JavaScript is turned off.** Render the final HTML in your POS (template
  engine, React `renderToString`, …) before sending it.
- For a QR code on your own invoice HTML, generate it in the POS (for
  example with the `qrcode` npm package) and embed it as an inline `<svg>`
  or a `data:` image.
- Set margins with `@page { margin: 15mm; }`. Use `page-break-inside: avoid`
  on table rows so long invoices break cleanly across pages.
- Test with **Test print** in the bridge first, then with a real invoice.

### `POST /terminal/charge`

```json
{ "amountMinorUnits": 1265, "currency": "USD", "reference": "SALE-1042" }
```

Returns when the terminal answers (or the timeout set in the bridge passes):

```json
{ "status": "approved", "reference": "SALE-1042", "authCode": "A1B2C3", "cardLast4": "4242" }
```

`status` is `approved`, `declined`, `error`, `cancelled` or `pending`.

### `POST /terminal/cancel`

```json
{ "reference": "SALE-1042" }
```

### `WS /events`

Browsers can't send headers on WebSockets, so pass the token in the URL:
`new WebSocket('ws://127.0.0.1:9191/events?token=' + encodeURIComponent(BRIDGE_TOKEN))`.
A wrong or missing token is rejected. Messages look
like `{ "event": "<name>", "payload": { … } }`:

| Event | Payload | When |
| --- | --- | --- |
| `bridge.status` | same as `GET /status` | Whenever a device's status changes (plugged, unplugged, paused…) |
| `terminal.status` | `{ status, reference, … }` | Payment progress: `pending` → `approved` / `declined` / … |

`terminal.status` goes to the printer computer only, never to paired
devices. A device removed in the bridge is disconnected with close code `4401`.

### Errors

Errors always come back as JSON with an `error` message:

| HTTP | Meaning | Example |
| --- | --- | --- |
| `400` | The request is wrong; `details` lists every problem | `{"error":"Invalid receipt","details":["\"currency\" must be a 3-letter code such as \"USD\" or \"LKR\""]}` |
| `401` | Missing or wrong token | `{"error":"unauthorized"}` |
| `403` | Not allowed from here: card payments from a paired device, the access token from another machine, or network access is off | `{"error":"Card payments can only be started from the computer the card terminal is connected to."}` |
| `429` | Too many pairing attempts | `{"error":"Too many attempts. Wait a minute and try again."}` |
| `404` | No printer with that API name | `{"error":"No printer named \"kitchen\". Available printers: \"receipt\", \"invoice\"."}` |
| `502` | The device failed; the message is written for the cashier | `{"error":"The printer is not connected. Check the USB cable and that the printer is turned on."}` |

---

## Best practices for POS developers

**Setup**

1. **Make the address and token settings, not code.** Each computer has its
   own token. Add *Bridge address* and *Access token* fields to your POS
   settings and keep them on that device. Never commit a token.
2. **Check the bridge when the POS starts.** Call `GET /health` (no token
   needed). If it fails, show *"Hardware bridge not running"* with a hint to
   open it from the Start menu.
3. **Show printer status in the POS.** Subscribe to `WS /events` and show a
   small indicator from `bridge.status`. Cashiers then spot an unplugged
   printer before a customer is waiting. If the socket drops, reconnect every
   few seconds.

**Printing**

4. **Save the sale first, then print.** Never let a printer problem block or
   undo a completed sale. If printing fails, show the bridge's error message
   and a **Reprint** button.
5. **Don't automatically retry prints.** A `502` means nothing was printed,
   so offering *Reprint* is safe. A timeout or dropped connection is
   different: the receipt may already have printed. Ask the cashier before
   printing again.
6. **Use a unique `saleReference`**, and mark reprints (for example
   `footer: "REPRINT"`) so duplicates are easy to spot.
7. **Send money as integers in minor units.** Do all rounding and tax
   calculations in the POS. Never send floats such as `12.5`.
8. **Keep text short.** 58 mm paper fits about 32 characters per line and
   80 mm about 42–48. Long item names wrap.
9. **Set a timeout** on requests, for example
   `AbortSignal.timeout(15000)` for printing.

**Card payments**

10. **One reference per payment attempt.** Use the sale reference plus an
    attempt number (for example `SALE-1042-1`), so a retry after a decline is
    never confused with the first try.
11. **Only mark the sale paid when `status` is `approved`**, and only then
    print `Paid by card`. Treat `pending`, `error` or a timeout as *not paid*,
    and check the terminal's own screen before charging again.
12. **Show progress from `terminal.status` events** rather than freezing the
    screen while the customer taps their card. Offer a **Cancel** button
    that calls `/terminal/cancel`.

**Handling errors**

13. **`401`** → the token changed. Ask the user to paste the new one from
    the bridge settings.
14. **`400`** → a bug in the POS. Log `details`; they name the exact field.
15. **`502`** → show `error` to the cashier as it is. It already says what to
    do.

**Several printers**

16. **Make the printer names settings too.** Let the shop choose which API
    name to use for receipts, kitchen tickets and invoices (load the choices
    from `GET /printers`), instead of hard-coding them.
17. **Leave out `printer` for the everyday case.** Receipts go to the default
    receipt printer and documents to the default document printer, so the
    shop can swap printers in the bridge without changing the POS.
18. **Print to each printer independently.** If the kitchen printer fails, the
    customer's receipt should still print. Send separate requests and report
    each result on its own.

**POS served from a website (`https://…`)**

Chrome and Edge allow an `https://` page to call `http://127.0.0.1`, and the
bridge answers Chrome's *Private Network Access* check. Other browsers may
block it. If yours does, run the POS from `http://localhost` or as a desktop
or PWA build.

---

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Tray icon not visible (Windows) | Click the **^** arrow next to the clock and drag the icon onto the taskbar. |
| *Printer disconnected* | Check the USB cable and power, and close the paper cover. The status updates within about 4 seconds. |
| *Printing is paused* | Click **Resume printing** in settings. |
| *N receipts waiting* | Turn the printer off and on. If old receipts shouldn't print, click **Clear waiting jobs**. |
| Blank paper or strange characters | Change **Printer language** (ESC/POS vs Star). If an A4 printer was added as a receipt printer by mistake, change **Used for** to *A4 / A5* in its settings. |
| A4 printer not listed under *Add a printer* | Install it in the computer's printer settings first, then click **Search again**. |
| *No printer named "…"* | The POS uses an API name that doesn't exist. Check the names on the printer cards, or under `GET /printers`. |
| Text cut off or too narrow | Change **Paper size**, then print a test page. |
| Receipt not cut, or the last lines stay inside the printer | The printer has no cutter: in its **Settings** set **Paper cutter** to **No cutter**, and choose **More** under *Extra paper at the end*. |
| Cut too close to the text, or too much blank paper | Change **Extra paper at the end**. |
| QR code missing, or random characters where it should be | In the printer's **Settings**, set **QR codes** to **Print as image**. That works on every printer. |
| QR code won't scan | Use a shorter link, or send `"size": "large"`. |
| POS says *unauthorized* | Copy the access token from settings into the POS again. |
| *Not running – port in use* | Another program uses port 9191. The bridge keeps retrying. Close that program, or change the port under **For developers** and update the POS. |
| Need logs for support | Tray icon → **Open log folder** → send `bridge.log`. |

---

## Development

```bash
npm install
npm run build      # compile TypeScript to dist/
npm start          # run the app
npm run dev:start  # rebuild on save and run
```

Auto-start isn't registered while you run from source; it only applies to
the installed app.

### Releases and automatic updates

Installed bridges update themselves from this repo's GitHub Releases. They
check 30 s after starting and then every 6 hours, download in the background,
and install the next time the bridge or the computer restarts. The tray shows
the version, and **Restart to update** once an update has downloaded. To release:

```bash
npm version 1.1.0 --no-git-tag-version   # bump package.json
git commit -am "Release 1.1.0" && git tag v1.1.0 && git push --follow-tags
```

The **Build Windows installer** workflow sees the `v*` tag, checks it matches
`package.json`, and publishes the installer plus `latest.yml` (what updaters
read) to a GitHub Release. macOS only updates itself when the app is
code-signed. Until then, install new Mac versions by hand.

### Building installers

| Command | Output (in `release/`) |
| --- | --- |
| `npm run dist:win` | Windows one-click installer `.exe` (run on Windows, or on an Intel Mac / Apple Silicon with Rosetta) |
| `npm run dist:win:from-mac` | Same, built on an Apple Silicon Mac without Rosetta. The `.exe` keeps Electron's default icon and version info. |
| `npm run dist:mac` | macOS `.dmg` |

The **Build Windows installer** GitHub Actions workflow
(`.github/workflows/build-windows.yml`) builds the Windows installer on a real
Windows machine. Run it from the Actions tab or push a `v*` tag. The `.exe`
is attached to the run as an artifact.

The app icon (`build/icon.png`) is drawn by code: `npm run icon` regenerates it.

### How it works

```
src/main/
  index.ts              App lifecycle, tray, notifications, auto-start, crash recovery
  server.ts             HTTP + WebSocket API (127.0.0.1, or the shop network when allowed)
  auth.ts               Who is calling: this computer (access token) or a paired device
  lan/                  Shop network: device pairing, tokens, mDNS announcement
  validation.ts         Request body checks → 400 with field-level details
  status-monitor.ts     Polls devices every 4 s, auto-setup, plain-language status
  printer/
    backend.ts          OS print-system interface
    cups-backend.ts     macOS/Linux: lpstat/lpinfo/lpadmin, raw jobs via `lp -o raw`
    windows-backend.ts  Windows: one long-lived hidden PowerShell process using the spooler API
    discovery.ts        Find USB/network printers
    setup.ts            Install and select printers, auto-setup
    printer.service.ts  Builds ESC/POS receipts (node-thermal-printer) and sends them
    document.service.ts A4/A5 pages: HTML → PDF → CUPS (macOS/Linux), silent print via the driver (Windows)
  terminal/             Serial card-terminal driver
src/renderer/settings/  Settings window
```

Thermal receipts are sent as raw ESC/POS bytes through the OS print queue
rather than by claiming the USB device directly. That avoids driver and permission
problems and works the same on every OS. Before sending, the bridge checks
the printer is really connected, so a receipt is never queued for an
unplugged printer and then printed unexpectedly later.

A4/A5 documents are rendered by Chromium in a hidden window with scripts
turned off. On macOS/Linux the page is turned into a PDF and handed to CUPS.
On Windows it's printed silently through the printer's own driver.

### Payment terminal protocol

`src/main/terminal/generic-serial-driver.ts` implements a simple default
framing (`STX + JSON + ETX` both ways) meant for in-house or white-label
serial terminals. Certified terminals (Ingenico, Verifone, PAX, etc.) use
their own vendor protocols. For those, implement `TerminalDriver`
(`src/main/terminal/terminal-driver.ts`) and swap it in from
`terminal.service.ts`. Nothing in `server.ts` needs to change.

---

## Security notes

- By default the API listens on `127.0.0.1` only and can't be reached from
  another computer. **Let phones and tablets print here** opens it to the shop
  network. Other machines then still need a device token, which they can
  only get with a fresh 6-digit code shown on the printer computer: single
  use, 10 minutes, 5 wrong guesses and it's gone, 10 attempts a minute per
  address. Device tokens are stored hashed, can't take card payments, and are
  revoked by **Remove**. Traffic on the shop network is plain HTTP, so only
  turn it on for a network you trust (not open guest Wi-Fi).
- The access token is a shared secret between the bridge and the POS on the
  same machine, and is refused from any other machine. It stops other local programs and web pages from printing or
  charging cards. Regenerate it from **For developers → Make a new password** if it leaks, then
  update the POS.
- The generic serial terminal path does not reduce PCI-DSS scope (for
  example with P2PE). That responsibility sits with the terminal and its
  firmware. If PCI scope matters, use a certified SDK such as Stripe
  Terminal instead.
