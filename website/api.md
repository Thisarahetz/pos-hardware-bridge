# API overview

The bridge serves a JSON HTTP API and a WebSocket. The complete,
machine-readable reference is OpenAPI 3 — browse it in the
**[full API reference](reference/index.html)**, generate a client in any
language from [`openapi.yaml`](https://github.com/Thisarahetz/pos-hardware-bridge/blob/master/docs/openapi.yaml),
or open `http://127.0.0.1:9191/docs` on any computer running the bridge.

## Base URL and auth

| Caller | Address | Token |
| --- | --- | --- |
| POS on the printer computer | `http://127.0.0.1:9191` | The access token from the bridge's settings (**Connect your POS**) |
| Phone, tablet or till on the shop Wi-Fi | The address in **Connect your POS → Phones & tablets**, e.g. `http://192.168.1.20:9191` | Its own device token, from [`POST /pair`](guides/devices.md) |

Send the token with every request except `/health` and `/pair`:

```http
Authorization: Bearer <token>
```

The access token is refused from other machines. Device tokens can't take card
payments. The port (`9191`) can be changed in the bridge under
**For developers**.

## Endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/health` | – | Is the bridge running, and are its printers ready? Includes its `id` and `name` |
| `POST` | `/pair` | – | A device on the shop network swaps a 6-digit code for its own token |
| `GET` | `/me` | ✔ | Whether this token is the printer computer or a paired device |
| `GET` | `/printers` | ✔ | Every printer with its API name, kind, `paperWidthChars` and live status |
| `GET` | `/status` | ✔ | Plain-language device status to show the cashier |
| `POST` | `/print/receipt` | ✔ | **Recommended.** Print a receipt [line by line](guides/receipts.md) (or the fixed JSON receipt) |
| `POST` | `/print/document` | ✔ | Print an [A4/A5 page](guides/documents.md) from HTML or PDF |
| `POST` | `/print/page` | ✔ | Print a ready-made [HTML bill](guides/documents.md#html-bills-on-a-thermal-printer) |
| `POST` | `/print/receiptline` | ✔ | Print a [ReceiptLine](guides/documents.md#receiptline) document |
| `POST` | `/preview/receiptline` | ✔ | A ReceiptLine document as an SVG, exactly as it will print |
| `POST` | `/print/test` | ✔ | Print the test page (`{ "printer": "…" }` optional) |
| `POST` | `/terminal/charge` | ✔ local | Take a [card payment](guides/payments.md) (printer computer only) |
| `POST` | `/terminal/cancel` | ✔ | Cancel a payment in progress |
| `GET` | `/terminal/status` | ✔ | `{ "connected": boolean }` |
| `GET` | `/docs` | – | The API reference in a browser (`/openapi.yaml` for the spec) |
| `WS` | `/events?token=…` | ✔ | [Live status and payment updates](#live-events) |

## Printers and status

```json title="GET /printers"
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

`level` is `ok`, `warning`, `error` or `off`. `title`, `detail` and `steps` are
written for cashiers — show them as they are.

## Live events

Browsers can't send headers on WebSockets, so pass the token in the URL:

```js
const ws = new WebSocket(`ws://127.0.0.1:9191/events?token=${encodeURIComponent(TOKEN)}`);
ws.onmessage = (e) => {
  const { event, payload } = JSON.parse(e.data);
  if (event === 'bridge.status') showPrinterStatus(payload); // same shape as GET /status
};
```

| Event | Payload | When |
| --- | --- | --- |
| `bridge.status` | Same as `GET /status` | Whenever a device's status changes (plugged, unplugged, paused…) |
| `terminal.status` | `{ status, reference, … }` | Payment progress: `pending` → `approved` / `declined` / … (printer computer only) |

A device removed in the bridge is disconnected with close code `4401`.

## Errors

Errors always come back as JSON with an `error` message:

| HTTP | Meaning | Example |
| --- | --- | --- |
| `400` | The request is wrong; `details` lists every problem | `{"error":"Invalid receipt","details":["blocks[3].right must be a string (max 60 characters)"]}` |
| `401` | Missing or wrong token | `{"error":"unauthorized"}` |
| `403` | Not allowed from here (card payments from a device, the access token from another machine, or network access is off) | `{"error":"Card payments can only be started from the computer the card terminal is connected to."}` |
| `404` | No printer with that API name | `{"error":"No printer named \"kitchen\". Available printers: \"receipt\", \"invoice\"."}` |
| `429` | Too many pairing attempts | `{"error":"Too many attempts. Wait a minute and try again."}` |
| `502` | The device failed; the message is written for the cashier | `{"error":"“Front counter” is not connected. Check the cable and that the printer is turned on."}` |

## For POS backends

To print from devices on any network through your own server, implement the
[print station protocol](guides/print-station.md).
