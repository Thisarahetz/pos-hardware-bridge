# React printer widget

The SDK comes with ready-made React components for your POS:

| Component | Where it goes | What it does |
| --- | --- | --- |
| `<PrinterSettings />` | Settings → Printers | Connect to the bridge (or pair a tablet), choose a printer for receipts, kitchen tickets and invoices, test print, set copies and auto-print. |
| `<PrinterStatusBadge />` | The POS header | A coloured dot and one line: *Printers ready*, *Kitchen: Out of paper*, *Bridge not reachable*. Updates live. |

They save the settings on the device, so your code only has to print:
`printFor('receipt', bill)`.

```bash
npm install pos-hardware-bridge
```

React 17 or newer. The components work in Vite, Next.js (client components),
Remix and Electron apps.

## Quick start

```tsx
// SettingsPage.tsx
import { PrinterSettings } from 'pos-hardware-bridge/react';

export function SettingsPage() {
  return <PrinterSettings />;
}
```

```tsx
// Header.tsx
import { PrinterStatusBadge } from 'pos-hardware-bridge/react';

export function Header() {
  return <PrinterStatusBadge onClick={() => navigate('/settings/printers')} />;
}
```

```ts
// After a sale is saved
import { ReceiptBuilder, loadPrintSettings, printFor } from 'pos-hardware-bridge';

if (loadPrintSettings().autoPrint) {
  const result = await printFor('receipt', bill, { title: `Bill #${sale.number}` });
  if (!result.ok && !result.skipped) showReprintToast(result.message, result.canRetry);
}
await printFor('kitchen', kitchenTicket); // does nothing if the shop chose "Don't print"
```

`printFor` never throws, because a printer problem must not break a sale. It
returns one of these:

| Result | Meaning | What to do |
| --- | --- | --- |
| `{ ok: true, printer }` | Printed | Nothing |
| `{ ok: false, skipped: true }` | Printing isn't set up, or this role is set to *Don't print* | Nothing |
| `{ ok: false, message, canRetry: true }` | The bridge refused it (out of paper, printer unplugged…) | Show `message` and a **Reprint** button |
| `{ ok: false, message, canRetry: false }` | No answer from the bridge, so it may have printed | Show `message` and ask before reprinting |

## What the shop sees

```text
Printers
┌─ 1. Connect to POS Hardware Bridge ───────────────────────────┐
│ (•) Printers are connected to this computer                    │
│ ( ) Printers are connected to another computer in the shop     │
│ [••••••••••••••••••••••]  [Connect]                            │
│ Connected to Front desk PC.                                    │
│ [Refresh printers] [Disconnect]                                │
└────────────────────────────────────────────────────────────────┘
┌─ 2. Choose printers ───────────────────────────────────────────┐
│ Customer receipts  [Default printer         ▾]  [Test print]   │
│ Kitchen tickets    [Kitchen (Out of paper)  ▾]  [Test print]   │
│ A4 invoices        [Don't print             ▾]  [Test print]   │
└────────────────────────────────────────────────────────────────┘
┌─ 3. Options ───────────────────────────────────────────────────┐
│ [x] Print the receipt automatically after each sale            │
│ Copies [1]                                                     │
└────────────────────────────────────────────────────────────────┘
```

Steps 2 and 3 appear once the device is connected. When the page is opened
again, it reconnects by itself and shows each printer's live status.

- **This computer:** the shop pastes the access token from the bridge's
  **Connect your POS** window. The address is always `http://127.0.0.1:9191`.
- **Another computer** (a tablet or second till): the shop types the address
  shown under **Phones & tablets** and the 6-digit code from **Get a code**.
  The widget pairs the device and saves its own token.

**Default printer** saves `''`, so the shop can swap printers in the bridge
without touching the POS. **Don't print** saves `null`.

## Your own print roles

The default roles are `receipt`, `kitchen` (off until chosen) and `invoice`.
Pass your own. Keep the array outside the component so it doesn't change on
every render:

```tsx
import type { PrintRoleConfig } from 'pos-hardware-bridge';

const ROLES: PrintRoleConfig[] = [
  { id: 'receipt', label: 'Customer receipts', kind: 'receipt', defaultPrinter: '' },
  { id: 'kitchen', label: 'Kitchen tickets', kind: 'receipt', defaultPrinter: null },
  { id: 'bar', label: 'Bar tickets', kind: 'receipt', defaultPrinter: null },
  { id: 'invoice', label: 'A4 invoices', kind: 'document', defaultPrinter: '' },
];

<PrinterSettings roles={ROLES} />;
await printFor('bar', drinksTicket, { roles: ROLES });
```

`kind` decides which printers are listed: thermal `receipt` printers or A4
`document` printers. `defaultPrinter` is used until the shop chooses: `''`
for the bridge's default printer, `null` for *Don't print*.

## Props

### `<PrinterSettings />`

| Prop | Default | |
| --- | --- | --- |
| `roles` | receipt, kitchen, invoice | The kinds of print your POS makes |
| `title` | `"Printers"` | Heading. `null` hides it, e.g. when your page has its own |
| `showOptions` | `true` | Show *Print automatically* and *Copies* |
| `storageKey` | `"pos-hardware-bridge.settings"` | Where settings are saved. Change it to keep several apart |
| `onConnected(connection)` | | After connecting: `{ bridgeName, version, kind, printers }` |
| `onChange(settings)` | | After every saved change |
| `unstyled` | `false` | Leave out the built-in styles |
| `className`, `style` | | On the outer `<section>` |

### `<PrinterStatusBadge />`

| Prop | Default | |
| --- | --- | --- |
| `onClick` | | Renders a button, e.g. to open the Printers settings |
| `pollMs` | `10000` | Safety-net check for a dropped connection or a bridge restart |
| `storageKey`, `unstyled`, `className`, `style` | | As above |

The badge's tooltip lists what to do (the bridge's `steps`), and it carries
`data-light="ok|warning|error|off"` for your own styling.

## Hooks

Build your own UI on the same saved settings:

```tsx
import { usePrintSettings, usePrinterStatus } from 'pos-hardware-bridge/react';

function AutoPrintToggle() {
  const [settings, save] = usePrintSettings();
  return (
    <Switch checked={settings.autoPrint} onChange={(on) => save({ ...settings, autoPrint: on })} />
  );
}

function PrinterLight() {
  const status = usePrinterStatus(); // null until the first check
  return <Dot color={status?.light ?? 'off'} title={status?.text} />;
}
```

Every widget and hook on the page, and in other tabs, updates when the
settings change.

## Styling

The components bring a small, neutral stylesheet that inherits your font and
colours and works in light and dark themes. Match your POS with CSS variables:

```css
.phb {
  --phb-accent: #7c3aed;      /* Connect, Pair buttons */
  --phb-accent-text: #fff;
  --phb-border: #e5e7eb;
  --phb-radius: 12px;
}
.phb-badge { --phb-ok: #22c55e; --phb-warning: #f59e0b; --phb-error: #ef4444; }
```

Or pass `unstyled` and style the `phb-*` classes yourself: `.phb`,
`.phb-row`, `.phb-role`, `.phb-check`, `.phb-primary`, `.phb-message`
(`data-tone="ok|error|info"`), `.phb-muted`, `.phb-badge` and `.phb-dot`
(`data-light`).

## Next.js

The components use the browser, so put them in a client component:

```tsx
'use client';
import { PrinterSettings } from 'pos-hardware-bridge/react';

export default function PrintersPage() {
  return <PrinterSettings />;
}
```

They render safely on the server. They only read saved settings and contact
the bridge in the browser.

## Without React

Everything the components do is also in the main package, with no UI:

| Function | Does |
| --- | --- |
| `loadPrintSettings()` / `savePrintSettings(s)` | This device's settings |
| `onPrintSettingsChange(listener)` | Settings changed (this tab or another); returns `stop()` |
| `connectToBridge(url, token)` | Check the bridge and token, load printers |
| `pairDevice(url, code, name)` | Pair a tablet; returns `{ url, token }` |
| `printFor(role, receipt, opts?)` | Print to the role's printer; never throws |
| `printInvoice(html, opts?)` | A4 page to the `invoice` printer |
| `printTestPageFor(role)` | Test page on the role's printer |
| `watchPrinterStatus(onChange)` | Live `{ light, text, steps }`; returns `stop()` |

## A web POS on https

A page served over `https://` can't call `http://127.0.0.1:9191` in every
browser. If the widget says it can't reach the bridge from your hosted POS
but works on `http://localhost`, print through your backend instead with the
[print station protocol](print-station.md).

## Check before you ship

- [ ] Open **Settings → Printers**, paste the token, and test print each role.
- [ ] Choose **Don't print** for a role, make a sale, and check nothing prints.
- [ ] Unplug a printer: the header badge turns red with the reason.
- [ ] Quit the bridge: the badge shows *not running*, and sales still save.
- [ ] Pair a tablet with a code and print from it.
