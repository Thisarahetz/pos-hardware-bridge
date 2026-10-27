# Changelog

All notable changes to POS Hardware Bridge. Versions follow
[semantic versioning](https://semver.org/).

## Unreleased

### Added
- **SDK 1.2.0: React printer widget** (`pos-hardware-bridge/react`):
  `<PrinterSettings />` for the POS settings page, `<PrinterStatusBadge />`
  for the header, and `usePrintSettings` / `usePrinterStatus` hooks. The main
  package gains the same logic with no UI: `printFor(role, receipt)`,
  `loadPrintSettings()`, `connectToBridge()`, `pairDevice()`,
  `watchPrinterStatus()`. Docs: *React printer widget* guide.
- Running the Windows build by hand on master publishes a GitHub Release, with
  a `POS-Hardware-Bridge-Setup.exe` that the install page links to directly.
- **Logos on receipts** — a new `image` line (`POST /print/receipt` and print-station
  jobs) prints a PNG or JPEG logo, centred and scaled to the paper in black and
  white. SDK: `ReceiptBuilder.image(base64, size?)`; `layoutReceipt` returns
  `image` items for previews.
- **Line-by-line receipts** — `POST /print/receipt` with `{ "blocks": [...] }`
  (`text`, `row`, `rule`, `qr`, `feed`), printed with the printer's own
  commands and fonts and wrapped to the paper width. Print-station jobs accept
  the same as `receipt`.
- `receipt-layout.ts`, the layout code shared with the SDK so POS apps can
  preview receipts exactly as they print.
- Print stations report each receipt printer's characters per line (`columns`).
- Docs: *Printer setup in your POS* guide, with a copy-ready printing module
  and React settings page in `examples/pos-setup/`.
- Receipt printers with their maker's driver can print HTML bills through it
  (**Print bills**: Auto / Printer driver / Direct).
- SDK 1.1.0: `ReceiptBuilder`, `BridgeClient.printReceipt()` and `layoutReceipt()`.
- Open-source project files and a documentation site.

### Fixed
- ReceiptLine QR codes and logos printed as garbage characters on non-Epson
  printers: images now use `GS v 0`, which every ESC/POS printer supports.
- ReceiptLine receipts printed with no gap between lines.

## 1.0.0

- First release: tray app with plug-and-play USB and network receipt printers,
  A4/A5 document printers, QR codes, cutter settings, ReceiptLine printing,
  shop-network pairing for phones and tablets, the print station protocol,
  a serial card-terminal driver, automatic updates and the npm SDK.
