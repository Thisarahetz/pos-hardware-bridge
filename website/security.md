# Security

## How the bridge stays safe

- **Local only by default.** The API listens on `127.0.0.1` and can't be
  reached from another computer.
- **The access token** is a shared secret between the bridge and the POS on
  the same computer, and is refused from any other machine. It stops other
  local programs and web pages from printing or charging cards. If it leaks,
  regenerate it under **For developers → Make a new password** and update
  the POS.
- **Shop-network access is opt-in.** *Let phones and tablets print here* opens
  the API to the local network. Other machines still need a device token,
  which they only get with a fresh 6-digit code shown on the printer computer:
  single use, valid 10 minutes, gone after 5 wrong guesses, 10 attempts a
  minute per address. Device tokens are stored hashed, can't take card
  payments, and are revoked by **Remove**.
- **Plain HTTP on the shop network.** Only turn network access on for a network
  you trust — not open guest Wi-Fi.
- **Print stations** keep their token in the computer's keychain (Windows
  DPAPI, macOS Keychain). **Disconnect** revokes it.
- **Pages sent for printing are sandboxed.** HTML renders with scripts off and
  no network access: only the page itself and inline `data:` images load.

## Card payments and PCI-DSS

The generic serial terminal driver does not reduce PCI-DSS scope (for example
with P2PE); that responsibility sits with the terminal and its firmware. If PCI
scope matters, use a certified SDK such as Stripe Terminal.

## Reporting a vulnerability

Please **don't open a public issue**. Report it privately on GitHub:
[Report a vulnerability](https://github.com/Thisarahetz/pos-hardware-bridge/security/advisories/new).
See the [security policy](https://github.com/Thisarahetz/pos-hardware-bridge/blob/master/SECURITY.md).
