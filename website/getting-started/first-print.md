# Your first print

Print a receipt from your own code in about five minutes. You need the bridge
running with a receipt printer set up, and its **access token** (settings
window → **Connect your POS → On this computer → Password**).

## 1. Check the bridge is running

```bash
curl http://127.0.0.1:9191/health
```

```json
{ "ok": true, "printerReady": true, "printers": [{ "id": "receipt", "kind": "receipt", "ready": true }] }
```

`/health` needs no token. Every other request sends it as
`Authorization: Bearer <token>`.

## 2. Print a receipt

=== "curl"

    ```bash
    export TOKEN='<access token>'

    curl -X POST http://127.0.0.1:9191/print/receipt \
      -H "Authorization: Bearer $TOKEN" \
      -H "Content-Type: application/json" \
      -d '{
        "blocks": [
          { "type": "text", "text": "MY SHOP", "align": "center", "bold": true, "size": "large" },
          { "type": "text", "text": "12 Main St", "align": "center" },
          { "type": "rule" },
          { "type": "row", "left": "2 x Latte", "right": "9.00", "bold": true },
          { "type": "row", "left": "1 x Croissant", "right": "3.50", "bold": true },
          { "type": "rule", "style": "double" },
          { "type": "row", "left": "TOTAL", "right": "12.50", "bold": true, "size": "tall" },
          { "type": "feed" },
          { "type": "text", "text": "Thank you!", "align": "center" }
        ]
      }'
    ```

=== "JavaScript (fetch)"

    ```js
    const res = await fetch('http://127.0.0.1:9191/print/receipt', {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        blocks: [
          { type: 'text', text: 'MY SHOP', align: 'center', bold: true, size: 'large' },
          { type: 'rule' },
          { type: 'row', left: '2 x Latte', right: '9.00', bold: true },
          { type: 'rule', style: 'double' },
          { type: 'row', left: 'TOTAL', right: '9.00', bold: true, size: 'tall' },
        ],
      }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error); // already written for the cashier
    ```

=== "SDK"

    ```bash
    npm install pos-hardware-bridge
    ```

    ```js
    import { BridgeClient, ReceiptBuilder } from 'pos-hardware-bridge';

    const bridge = new BridgeClient({ token: TOKEN });
    await bridge.printReceipt(
      new ReceiptBuilder()
        .center('MY SHOP', { bold: true, size: 'large' })
        .rule()
        .item({ name: 'Latte', qty: 2, total: '9.00' })
        .rule('double')
        .total('TOTAL', '9.00'),
    );
    ```

=== "Python"

    ```python
    import requests

    requests.post(
        "http://127.0.0.1:9191/print/receipt",
        headers={"Authorization": f"Bearer {TOKEN}"},
        json={"blocks": [
            {"type": "text", "text": "MY SHOP", "align": "center", "bold": True, "size": "large"},
            {"type": "rule"},
            {"type": "row", "left": "2 x Latte", "right": "9.00", "bold": True},
            {"type": "row", "left": "TOTAL", "right": "9.00", "bold": True, "size": "tall"},
        ]},
        timeout=15,
    ).raise_for_status()
    ```

The response names the printer that printed it:

```json
{ "ok": true, "printer": "receipt" }
```

!!! tip "Pick a printer"
    Add `"printer": "kitchen"` to send it to another printer by its API name.
    Leave it out to use the default receipt printer. `GET /printers` lists
    them all.

## 3. When something's wrong

Errors come back as JSON with a message written for the cashier, so you can
show it as it is:

```json
{ "error": "“Front counter” is not connected. Check the cable and that the printer is turned on." }
```

A `400` lists every problem with your request in `details`. See
[Errors](../api.md#errors).

## Next

- [Printer setup in your POS](../guides/pos-setup.md) — a settings page to
  connect the POS, choose printers and test print, ready to copy.
- [Receipts, line by line](../guides/receipts.md) — every line type, a full bill
  and previews.
- [Best practices](../guides/best-practices.md) — how to build printing into a
  POS that cashiers can rely on.
