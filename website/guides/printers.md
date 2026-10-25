# Printer settings

Every printer has its own settings in the bridge (printer card → **Settings**).
Your POS never configures printers: it picks one by **API name** and the
bridge does the rest.

## Names and defaults

- **Name** — what the shop sees, e.g. *Front counter*.
- **API name** — what your POS sends as `"printer"`, e.g. `receipt`,
  `kitchen`, `invoice`. Short, no spaces.
- **Default** — the first printer of each kind is the default for it. Requests
  without `"printer"` go to the default receipt printer (receipts) or the
  default A4 printer (documents). Use **Make default** to change it.

`GET /printers` lists every printer with its API name, kind and live status,
so your POS can offer a "Print to…" menu.

## Settings

### Receipt printers

| Setting | Options | What it does |
| --- | --- | --- |
| **Paper size** | 58 mm · 80 mm · 80 mm (wide) | Characters per line: 32, 42 or 48. Run **Test print**: the number line should reach the right edge. If 80 mm text stops short of the edge, choose *80 mm (wide)*. |
| **Printer language** | ESC/POS · Star | ESC/POS for almost every printer (Epson, Xprinter, Rongta, Bixolon, POS-80/58…). Star only for Star Micronics. |
| **Character set** | Multilingual, CP437, CP1252, Shift-JIS, GB18030, Big5, … | Which letters print. *Multilingual* covers English and most European languages. `?` on paper means the letter isn't in the set. |
| **Paper cutter** | Full cut · Partial cut · No cutter | Partial leaves a small tab so the receipt doesn't fall. *No cutter* feeds extra paper so the cashier can tear it off without losing text. |
| **QR codes** | Print as image · Built-in | *Print as image* works on every printer. *Built-in* uses the printer's QR command: sharper and faster, but not on every model. |
| **Extra paper at the end** | Less · Normal · More · Most | Blank space after the last line, before the cut. |
| **Print bills** | Auto · Printer driver · Direct | Only for HTML bills sent with [`/print/page`](documents.md#html-bills-on-a-thermal-printer). Line-by-line receipts always print directly. |
| **Used for** | Receipts · A4 / A5 | Switch a printer added as the wrong kind. |

### A4 / A5 printers

| Setting | What it does |
| --- | --- |
| **Paper size** | A4, A5, Letter or Legal — used when the POS doesn't ask for one. |

A4 printers print through the computer's normal printer driver. Install them
in the operating system first, then add them in the bridge.

## Connections

- **USB** — the bridge sends receipts through the operating system's print
  queue (CUPS on macOS/Linux, the spooler on Windows) as raw printer commands.
  Plug-and-play setup creates that queue for you. Before printing, the bridge
  checks the printer is really connected, so a receipt is never queued for an
  unplugged printer and printed unexpectedly later.
- **Network** — receipt printers on Wi-Fi or Ethernet are reached directly on
  their raw port (usually `9100`).
- **System printer** — any printer already installed on the computer can be
  added, receipt or A4.

## Several printers

```js
// Customer receipt on the front counter, ticket in the kitchen
await bridge.printReceipt(bill);                          // default receipt printer
await bridge.printReceipt(ticket, { printer: 'kitchen' }); // named printer
await bridge.printDocument({ html: invoiceHtml }, { printer: 'invoice' });
```

Send separate requests and report each result on its own: if the kitchen
printer is out of paper, the customer's receipt should still print.
