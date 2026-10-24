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

---

## Contents

1. [Install (shop computer)](#install-shop-computer)
2. [First-time setup](#first-time-setup)
3. [Connect your POS – quick start](#connect-your-pos--quick-start)
4. [API reference](#api-reference)
5. [Best practices for POS developers](#best-practices-for-pos-developers)
6. [Troubleshooting](#troubleshooting)
7. [Development](#development)
8. [Security notes](#security-notes)

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
3. **A4 printer for invoices (optional):** first install it the normal way
   (Windows: *Settings → Printers & scanners*; macOS: *System Settings →
   Printers & Scanners*). Then in the bridge, under **Add a printer**, click
   **Add as A4 printer** next to it, and use **Test print** to print a sample invoice.
4. **More receipt printers (optional)**, e.g. a kitchen printer: plug it in and click
   **Add as receipt printer**. Open its **Settings** to give it a clear name and API name
   (for example `kitchen`).
5. *(Optional)* Card terminal: tick **Use a card terminal**, pick its port,
   and click **Test $1.00 charge**.
6. Under **Connect your POS**, copy the **Bridge address** and **Access token**
   into your POS settings.

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

## Connect your POS – quick start

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
settings window under **Connect your POS → Developer details → Copy example**.

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

Base URL: `http://127.0.0.1:<port>` (default port `9191`). All request and
response bodies are JSON. **All money values are whole numbers in minor
units** (cents): `12.50` is sent as `1250`.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/health` | – | Is the bridge running? Are devices ready? |
| `GET` | `/status` | ✔ | Plain-language device status to show the cashier |
| `GET` | `/printers` | ✔ | All configured printers with their API names and status |
| `POST` | `/print/receipt` | ✔ | Print a receipt (thermal, or laid out on A4) |
| `POST` | `/print/document` | ✔ | Print an A4/A5 invoice or document (HTML or PDF) |
| `POST` | `/print/test` | ✔ | Print a test page (`{"printer":"…"}` optional) |
| `POST` | `/terminal/charge` | ✔ | Take a card payment |
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

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `printer` | string | | API name, e.g. `"kitchen"`. Defaults to the default receipt printer |
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
| `footer` | string | | Printed centred at the bottom |

The bridge prints the totals you send and does no maths of its own, so
calculate them in the POS.

Sending a receipt to an A4 printer (`"printer": "invoice"`) prints the same
data laid out as a page with an item table and totals. That's a quick way
to get A4 invoices without writing any HTML.

Response: `{ "ok": true, "printer": "receipt" }`, naming the printer that was used.

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

### Errors

Errors always come back as JSON with an `error` message:

| HTTP | Meaning | Example |
| --- | --- | --- |
| `400` | The request is wrong; `details` lists every problem | `{"error":"Invalid receipt","details":["\"currency\" must be a 3-letter code such as \"USD\" or \"LKR\""]}` |
| `401` | Missing or wrong token | `{"error":"unauthorized"}` |
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
| POS says *unauthorized* | Copy the access token from settings into the POS again. |
| *API stopped – port in use* | Another program uses port 9191. The bridge keeps retrying. Close that program, or change the port under Developer details and update the POS. |
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
  server.ts             Local HTTP + WebSocket API (127.0.0.1 only)
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

- The API listens on `127.0.0.1` only and can never be reached from another
  computer.
- The access token is a shared secret between the bridge and the POS on the
  same machine. It stops other local programs and web pages from printing or
  charging cards. Regenerate it from **Developer details** if it leaks, then
  update the POS.
- The generic serial terminal path does not reduce PCI-DSS scope (for
  example with P2PE). That responsibility sits with the terminal and its
  firmware. If PCI scope matters, use a certified SDK such as Stripe
  Terminal instead.
