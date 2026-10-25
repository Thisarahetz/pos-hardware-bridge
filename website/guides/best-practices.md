# Best practices

How to build printing into a POS that cashiers can rely on. For a ready-made
settings page and printing module that follow these rules, see
[Printer setup in your POS](pos-setup.md).

## Setup

1. **Make the address and token settings, not code.** Each computer has its
   own token. Add *Bridge address* and *Access token* fields to your POS
   settings and store them on that device. Never commit a token.
2. **Check the bridge when the POS starts.** Call `GET /health` (no token).
   If it fails, show *"Hardware bridge not running"* with a hint to open it
   from the Start menu.
3. **Show printer status.** Subscribe to [`WS /events`](../api.md#live-events)
   and show a small indicator from `bridge.status`, so cashiers spot an
   unplugged printer before a customer is waiting. Reconnect every few
   seconds if the socket drops.

## Printing

4. **Save the sale first, then print.** A printer problem must never block or
   undo a completed sale. If printing fails, show the bridge's message and a
   **Reprint** button.
5. **Don't retry prints automatically.** A `502` means nothing printed, so
   offering *Reprint* is safe. A timeout or dropped connection is different:
   the receipt may already have printed. Ask the cashier first.
6. **Mark reprints** (a `REPRINT` banner) so duplicates are easy to spot.
7. **Send receipts [line by line](receipts.md)**, format money in the POS,
   and let the bridge fit the paper. Don't pad with spaces.
8. **Set a timeout** on requests, e.g. `AbortSignal.timeout(15000)`.

## Several printers

9. **Make printer names settings too.** Let the shop choose which API name to
   use for receipts, kitchen tickets and invoices (load the choices from
   `GET /printers`) instead of hard-coding them.
10. **Leave out `printer` for the everyday case.** Receipts then go to the
    default receipt printer, so the shop can swap printers in the bridge
    without touching the POS.
11. **Print to each printer independently.** If the kitchen printer fails, the
    customer's receipt should still print.

## Errors

| Status | What to do |
| --- | --- |
| `400` | A bug in your POS. Log `details` — they name the exact field. |
| `401` | The token changed. Ask for the new one from the bridge settings. |
| `404` | No printer with that API name. Refresh your list from `GET /printers`. |
| `502` | Show `error` to the cashier as it is — it already says what to do. |
| No answer | The bridge isn't running, or the printer computer is off. |
