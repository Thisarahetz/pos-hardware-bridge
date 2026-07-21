# POS Hardware Bridge

A small Electron tray app that gives any browser-based POS (GlowDesk, SmartPOS,
Restaurant POS, etc.) access to local hardware that browsers can't reach
directly: USB/network receipt printers and a serial payment terminal.

It runs in the background, exposes a local HTTP + WebSocket API on
`127.0.0.1`, and a settings window (from the tray icon) to configure devices.

## Why a separate app instead of code inside one project

Browsers have no API for raw USB/serial access to POS-grade hardware. Any
number of web apps on the same machine can talk to this one bridge over
`localhost`, so it's built standalone rather than baked into a single
project's codebase.

## Run in development

```bash
npm install
npm run build
npm start
```

This starts the tray icon and opens the settings window. The local API listens
on `127.0.0.1:<port>` (default `9191`).

## Package a build

```bash
npm run dist
```

Produces an installer/binary via `electron-builder` (see `build` key in
`package.json` for per-OS targets). Replace the placeholder tray icon
(`nativeImage.createEmpty()` in `src/main/index.ts`) with a real asset first.

## Configuring hardware

Open the tray icon → **Settings…**

- **Receipt printer**
  - *USB*: pick from printers already installed in the OS (CUPS on
    mac/Linux, the Windows print spooler). Thermal receipt printers are
    normally installed this way — the bridge sends raw ESC/POS bytes through
    that OS print queue rather than claiming the USB device directly, which
    avoids fragile driver/permission issues and works the same on every OS.
  - *Network*: enter the printer's IP and port (usually `9100`).
- **Payment terminal**: pick the serial port the terminal is attached to, set
  baud rate and response timeout, and enable it.

Click **Test print** / **Test $1.00 charge** to verify each device once
configured.

## Integrating a POS web app

Every request (other than `/health`) requires the bearer token shown in
Settings:

```
Authorization: Bearer <token from settings window>
```

Bind requests to `http://127.0.0.1:<port>` — CORS is open to any localhost
origin, the token is the actual gate.

### `GET /health`
No auth required. `{ ok, printer, terminal }` — whether each device is enabled.

### `POST /print/receipt`
Renders and prints a structured receipt.

```jsonc
{
  "businessName": "GlowDesk Salon",
  "locationName": "Downtown",
  "saleReference": "SALE-1042",
  "timestamp": "2026-07-21T10:32:00Z",
  "lines": [
    { "label": "Haircut", "qty": 1, "totalAmount": 4500 },
    { "label": "Shampoo", "qty": 2, "totalAmount": 1800 }
  ],
  "subtotalAmount": 6300,
  "taxAmount": 630,
  "totalAmount": 6930,
  "currency": "USD",
  "paymentMethod": "card",
  "footer": "Thank you!"
}
```

All money fields are integer minor units (cents), matching how the shared
`@glowdesk/shared` POS types already model money.

### `POST /print/test`
Prints a fixed test page — no body needed.

### `POST /terminal/charge`
```json
{ "amountMinorUnits": 4500, "currency": "USD", "reference": "SALE-1042" }
```
Returns `{ status, reference, authCode?, cardLast4?, message? }` once the
terminal responds (or the configured timeout elapses). Also broadcast over
`GET /events` (WebSocket) as `{ "event": "terminal.status", "payload": {...} }`
so a UI can show a live "processing…" state instead of blocking on the HTTP
response.

### `POST /terminal/cancel`
```json
{ "reference": "SALE-1042" }
```

### `GET /terminal/status`
`{ connected: boolean }`

## Payment terminal protocol

`src/main/terminal/generic-serial-driver.ts` implements a simple default
framing (`STX + JSON + ETX` both ways) meant for in-house or white-label
serial terminals. Certified terminals (Ingenico, Verifone, PAX, etc.) use
their own vendor protocols — implement `TerminalDriver`
(`src/main/terminal/terminal-driver.ts`) again for those and swap it in from
`terminal.service.ts`; nothing in `server.ts` needs to change.

## Security notes

- The HTTP/WS server binds to `127.0.0.1` only — never reachable off the
  machine.
- The bearer token is a shared secret between this app and the POS web app
  you paste it into, not a replacement for TLS/remote auth (there is no
  remote exposure to protect against here).
- This app does not implement PCI-DSS scope reduction (e.g. P2PE) for the
  generic serial terminal path — that responsibility sits with whatever
  terminal/firmware you pair it with. Using Stripe Terminal or another
  certified SDK instead of the generic serial driver is the safer default
  if PCI scope matters for your deployment.
