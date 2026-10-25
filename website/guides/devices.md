# Phones & tablets

Connect the printers to **one computer** and run the bridge there. Every other
device in the shop prints to it — no device needs printer setup.

There are two ways:

| | Shop Wi-Fi | [Print station](print-station.md) |
| --- | --- | --- |
| Works for | Native, Electron, Android and iOS apps on the shop network | Every device, any network — including hosted web POS and mobile data |
| Your POS needs | Nothing extra: call the bridge directly | Five routes on your backend |
| Setup at the shop | Turn on, pair each device with a code | Pair the printer computer once with a code |
| Card payments | No — printer computer only | No |

## Pair a device over the shop Wi-Fi

1. In the bridge, open **Connect your POS → Phones & tablets** and turn on
   **Let phones and tablets print here**. Allow the bridge if the firewall
   asks (Windows asks once).
2. Click **Get a code**. A 6-digit code appears, valid for 10 minutes and for
   one device.
3. In your POS app on the device, enter the bridge address shown in that tab
   (for example `http://192.168.1.20:9191`) and the code. Your app calls
   `POST /pair` and saves the device token it gets back.

=== "SDK"

    ```js
    import { BridgeClient } from 'pos-hardware-bridge';

    // Once, on the tablet:
    const { url, token } = await BridgeClient.pair({
      url: 'http://192.168.1.20:9191',
      code: '482 913',
      name: 'Kitchen tablet',
    });
    // Save url + token. From then on:
    const bridge = new BridgeClient({ url, token });
    await bridge.printReceipt(ticket, { printer: 'kitchen' });
    ```

=== "HTTP"

    ```bash
    curl -X POST http://192.168.1.20:9191/pair \
      -H "Content-Type: application/json" \
      -d '{ "code": "482913", "name": "Kitchen tablet" }'
    # → { "token": "…", "deviceId": "…", "deviceName": "Kitchen tablet", "bridge": { "id": "…", "name": "…" } }
    ```

    Then send `Authorization: Bearer <token>` with every request to the same
    address.

Paired devices are listed in the bridge with when they were last used, and can
be renamed or removed at any time. Removing one cuts it off immediately. A
device token can print and read status; it can't take card payments.

## Find the bridge automatically

The bridge announces itself on the network with mDNS/Bonjour as
`_pos-bridge._tcp` (TXT records `id`, `name`, `version`), so a native app can
list bridges instead of asking for the address. `GET /health` (no token)
returns the bridge's `id` and `name` too.

## Web POS served over HTTPS

A page served over `https://` can't call a plain `http://192.168.x.x` address —
browsers block it as mixed content. Use the [print station](print-station.md)
instead, or wrap your POS as a native or Electron app.

On the printer computer itself, Chrome and Edge do allow an `https://` page to
call `http://127.0.0.1`; the bridge answers Chrome's *Private Network Access*
check. Other browsers may block it — then run the POS from `http://localhost`
or as a desktop/PWA build.
