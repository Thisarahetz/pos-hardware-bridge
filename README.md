<p align="center">
  <img src="build/icon.png" width="96" height="96" alt="">
</p>

<h1 align="center">POS Hardware Bridge</h1>

<p align="center">
  <b>Print receipts, kitchen tickets and A4 invoices from any POS — on any thermal printer.</b><br>
  A free, open-source tray app for Windows, macOS and Linux with a simple local HTTP API.
</p>

<p align="center">
  <a href="https://thisarahetz.github.io/pos-hardware-bridge/"><b>Documentation</b></a> ·
  <a href="https://github.com/Thisarahetz/pos-hardware-bridge/releases/latest">Download</a> ·
  <a href="https://thisarahetz.github.io/pos-hardware-bridge/getting-started/first-print/">First print in 5 minutes</a> ·
  <a href="https://thisarahetz.github.io/pos-hardware-bridge/reference/">API reference</a>
</p>

<p align="center">
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/github/license/Thisarahetz/pos-hardware-bridge"></a>
  <a href="https://github.com/Thisarahetz/pos-hardware-bridge/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/Thisarahetz/pos-hardware-bridge"></a>
  <a href="https://www.npmjs.com/package/pos-hardware-bridge"><img alt="npm" src="https://img.shields.io/npm/v/pos-hardware-bridge?label=sdk"></a>
  <a href="https://github.com/Thisarahetz/pos-hardware-bridge/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/Thisarahetz/pos-hardware-bridge/actions/workflows/ci.yml/badge.svg"></a>
</p>

---

Browsers can't talk to USB receipt printers or card terminals. **POS Hardware
Bridge** runs on the shop computer, sets the printers up for you, and gives
your POS a simple HTTP API on `http://127.0.0.1:9191`. Your POS sends a
receipt; the bridge prints it.

- **Sharp receipts on any printer** — sent line by line and printed with the
  printer's own fonts, never as a blurry picture. Any ESC/POS or Star printer,
  58mm or 80mm.
- **Plug and play** — a USB receipt printer is ready in seconds; network
  printers are found with one click. Your POS never configures a printer.
- **Many printers, one computer** — front counter, kitchen and A4 invoice
  printers side by side, picked by name: `receipt`, `kitchen`, `invoice`.
- **Every device in the shop** — phones, tablets and other tills print here too,
  over the shop Wi-Fi or from anywhere through your POS backend
  ([print station protocol](https://thisarahetz.github.io/pos-hardware-bridge/guides/print-station/)).
- **Clear status** — the tray and the API tell the cashier exactly what's wrong
  and what to do.
- **Made for developers** — an [OpenAPI-documented API](docs/openapi.yaml), an
  [npm SDK](packages/sdk#readme) with TypeScript types, and receipt previews
  that match the paper exactly.

## Quick start

1. **Install** the bridge on the computer the printers are plugged into —
   [download the latest release](https://github.com/Thisarahetz/pos-hardware-bridge/releases/latest).
2. **Plug in** a receipt printer and click **Test print**.
3. **Copy the access token** from *Connect your POS* and print:

```bash
curl -X POST http://127.0.0.1:9191/print/receipt \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "blocks": [
      { "type": "text", "text": "MY SHOP", "align": "center", "bold": true, "size": "large" },
      { "type": "rule" },
      { "type": "row", "left": "2 x Latte", "right": "9.00", "bold": true },
      { "type": "rule", "style": "double" },
      { "type": "row", "left": "TOTAL", "right": "9.00", "bold": true, "size": "tall" },
      { "type": "qr", "data": "https://myshop.example/r/1042", "label": "Scan for your e-receipt" }
    ]
  }'
```

Or with the SDK (`npm install pos-hardware-bridge`):

```js
import { BridgeClient, ReceiptBuilder } from 'pos-hardware-bridge';

const bridge = new BridgeClient({ token: '<access token>' });

await bridge.printReceipt(
  new ReceiptBuilder()
    .center('MY SHOP', { bold: true, size: 'large' })
    .rule()
    .item({ name: 'Latte', qty: 2, total: '9.00' })
    .rule('double')
    .total('TOTAL', '9.00')
    .qr('https://myshop.example/r/1042', 'Scan for your e-receipt'),
);
```

The bridge wraps text for the paper (32 characters on 58mm, 42 or 48 on 80mm),
so the same receipt prints correctly on every printer.

## Documentation

**https://thisarahetz.github.io/pos-hardware-bridge/**

| | |
| --- | --- |
| [Install](https://thisarahetz.github.io/pos-hardware-bridge/getting-started/install/) · [Set up printers](https://thisarahetz.github.io/pos-hardware-bridge/getting-started/setup/) | For shops: install, add printers, status colours |
| [Receipts, line by line](https://thisarahetz.github.io/pos-hardware-bridge/guides/receipts/) | Every line type, a full bill, previews that match the paper |
| [A4 invoices & HTML](https://thisarahetz.github.io/pos-hardware-bridge/guides/documents/) | Full-page documents through the printer driver |
| [Phones & tablets](https://thisarahetz.github.io/pos-hardware-bridge/guides/devices/) · [Print station](https://thisarahetz.github.io/pos-hardware-bridge/guides/print-station/) | Print from every device in the shop |
| [SDK](https://thisarahetz.github.io/pos-hardware-bridge/sdk/) · [API](https://thisarahetz.github.io/pos-hardware-bridge/api/) · [Full reference](https://thisarahetz.github.io/pos-hardware-bridge/reference/) | For developers |
| [Best practices](https://thisarahetz.github.io/pos-hardware-bridge/guides/best-practices/) · [Troubleshooting](https://thisarahetz.github.io/pos-hardware-bridge/troubleshooting/) | Reliable printing, and fixes |

## Development

```bash
git clone https://github.com/Thisarahetz/pos-hardware-bridge.git
cd pos-hardware-bridge
npm install
npm run dev:start     # rebuild on save and run the app
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the project layout, the docs site
and how releases work.

## Contributing

Bug reports, printer compatibility notes, docs fixes and pull requests are all
welcome — read [CONTRIBUTING.md](CONTRIBUTING.md) and the
[code of conduct](CODE_OF_CONDUCT.md). Found a security problem? Please
[report it privately](SECURITY.md).

## License

[MIT](LICENSE) © 2026 Thisara Hettikankanam
