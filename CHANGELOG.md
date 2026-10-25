# Changelog

All notable changes to POS Hardware Bridge. Versions follow
[semantic versioning](https://semver.org/).

## Unreleased

### Added
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
