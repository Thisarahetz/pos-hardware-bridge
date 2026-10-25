# Set up printers

Open the bridge from the tray icon to see its settings window.

## 1. Add a receipt printer

=== "USB"

    Plug the printer in and turn it on. Within a few seconds you'll see
    *"Printer connected"* and the status turns green.

    On Windows, if the printer has never been installed, click **Set up** next
    to it and choose **Yes** on the Windows permission prompt (once only).

=== "Network (Wi-Fi / Ethernet)"

    Click **Scan network**, or enter the printer's IP address under
    *Network printer by IP address*. The port is usually `9100`.

## 2. Print a test page

Click **Test print** on the printer and check the paper:

- **The number line should reach the right edge.** If it stops short or wraps,
  open the printer's **Settings** and change **Paper size**:
  58 mm (32 characters), 80 mm (42) or 80 mm wide (48).
- **The QR code should scan** with a phone. If it's missing or garbled, set
  **QR codes** to **Print as image**.
- **Cutter:** if the printer cuts by itself, choose **Full cut** or
  **Partial cut**. If receipts are torn off by hand, choose **No cutter** —
  the bridge then feeds extra paper so nothing is torn off.

See [Printer settings](../guides/printers.md) for every option.

## 3. More printers (optional)

- **Kitchen or bar printer:** plug it in and click **Add as receipt printer**.
  In its **Settings**, give it a clear name and an **API name** such as
  `kitchen`.
- **A4/A5 printer for invoices:** install it the normal way first (Windows:
  *Settings → Printers & scanners*; macOS: *System Settings → Printers &
  Scanners*). Then click **Add as A4 printer** next to it in the bridge.

Each printer has an **API name**, shown on its card. Your POS uses it to pick
a printer. The first printer of each type is the **default**; use **Make
default** in a printer's settings to change that.

## 4. Connect your POS

Under **Connect your POS → On this computer**, copy the **Address**
(`http://127.0.0.1:9191`) and **Password** (the access token) into your POS
settings. For phones and tablets, see [Phones & tablets](../guides/devices.md).

## What the status colours mean

| Tray dot | Meaning | What to do |
| --- | --- | --- |
| :green_circle: green | Ready | Nothing |
| :yellow_circle: yellow | Needs attention (paused, receipts stuck) | Open settings and use the button shown |
| :red_circle: red | Printer unplugged or unreachable | Follow the steps shown in the settings window |
| :white_circle: grey | Not set up or turned off | Plug in a printer or pick one |

Next: [your first print](first-print.md).
