# Card payments

The bridge can drive a serial card terminal connected to the printer computer.

## Set up

In the bridge, tick **Use a card terminal**, pick its port, and click
**Test $1.00 charge**.

## Take a payment

```http
POST /terminal/charge
```

```json
{ "amountMinorUnits": 1265, "currency": "USD", "reference": "SALE-1042-1" }
```

Amounts are whole numbers in minor units (cents): `12.65` is `1265`. The
request returns when the terminal answers, or when the timeout set in the
bridge passes:

```json
{ "status": "approved", "reference": "SALE-1042-1", "authCode": "A1B2C3", "cardLast4": "4242" }
```

`status` is `approved`, `declined`, `error`, `cancelled` or `pending`.

Cancel a payment in progress with `POST /terminal/cancel`
(`{ "reference": "SALE-1042-1" }`). Follow progress live from the
`terminal.status` event on [`WS /events`](../api.md#live-events).

!!! warning "Only from the printer computer"
    Card payments can only be started with the computer's own access token —
    never from a paired phone or tablet.

## Rules

- **One reference per attempt.** Use the sale reference plus an attempt number
  (`SALE-1042-1`, `SALE-1042-2`), so a retry after a decline is never confused
  with the first try.
- **Only mark the sale paid when `status` is `approved`.** Treat `pending`,
  `error` or a timeout as *not paid*, and check the terminal's own screen
  before charging again.
- **Show progress** from `terminal.status` events instead of freezing the
  screen, and offer a **Cancel** button.

## Terminal protocol

The built-in driver (`src/main/terminal/generic-serial-driver.ts`) uses a
simple framing — `STX + JSON + ETX` both ways — meant for in-house or
white-label serial terminals. Certified terminals (Ingenico, Verifone, PAX…)
use their own vendor protocols: implement `TerminalDriver`
(`src/main/terminal/terminal-driver.ts`) and swap it in from
`terminal.service.ts`. Nothing in the API changes.

!!! danger "PCI-DSS"
    The generic serial path does not reduce PCI-DSS scope (for example with
    P2PE); that responsibility sits with the terminal and its firmware. If PCI
    scope matters, use a certified SDK such as Stripe Terminal.
