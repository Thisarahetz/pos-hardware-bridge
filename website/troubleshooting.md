# Troubleshooting

## Printing

| Problem | Fix |
| --- | --- |
| *Printer disconnected* | Check the USB cable and power, and close the paper cover. The status updates within about 4 seconds. |
| *Printing is paused* | Click **Resume printing** in the bridge. |
| *N receipts waiting* | Turn the printer off and on. If old receipts shouldn't print, click **Clear waiting jobs**. |
| Amounts stop short of the right edge, or lines wrap early | **Paper size** doesn't match the printer. Run **Test print** and pick 58 mm, 80 mm or 80 mm (wide) until the number line reaches the edge. |
| Rows of random letters where a QR code or logo should be | Update the bridge: older versions used an image command only Epson printers understand. For the fixed JSON receipt, set **QR codes** to **Print as image**. |
| Blank paper or strange characters everywhere | Change **Printer language** (ESC/POS vs Star). If an A4 printer was added as a receipt printer, change **Used for** to *A4 / A5*. |
| `?` instead of some letters | The printer's **Character set** doesn't have them. Pick the right one for your language. |
| Receipt not cut, or the last lines stay inside the printer | The printer has no cutter: set **Paper cutter** to **No cutter** and **Extra paper at the end** to *More*. |
| Cut too close to the text, or too much blank paper | Change **Extra paper at the end**. |
| QR code won't scan | Use a shorter link, or `"size": "large"`. |
| A4 printer not listed under *Add a printer* | Install it in the computer's printer settings first, then click **Search again**. |

## Connecting

| Problem | Fix |
| --- | --- |
| POS says *unauthorized* (`401`) | Copy the access token from the bridge settings into the POS again. |
| *No printer named "…"* (`404`) | The POS uses an API name that doesn't exist. Check the names on the printer cards, or `GET /printers`. |
| *Not running – port in use* | Another program uses port 9191. Close it, or change the port under **For developers** and update the POS. |
| A tablet can't reach the bridge | Check **Let phones and tablets print here** is on, both are on the same Wi-Fi (not guest Wi-Fi), and the firewall allowed the bridge. |
| A web POS on `https://` can't reach `http://192.168.…` | Browsers block this (mixed content). Use the [print station](guides/print-station.md), or a native/desktop app. |
| Tray icon not visible (Windows) | Click the **^** arrow next to the clock and drag the icon onto the taskbar. |

## Getting help

1. Tray icon → **Open log folder** → `bridge.log`.
2. [Open an issue](https://github.com/Thisarahetz/pos-hardware-bridge/issues/new/choose)
   with what happened, a photo of the print if it's wrong, the printer model
   and paper width, the bridge version (tray menu) and the relevant log lines.
