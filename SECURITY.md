# Security policy

POS Hardware Bridge runs on shop computers, drives printers and card terminals,
and can accept connections from the shop network. Please report security
problems privately so they can be fixed before they're widely known.

## Reporting a vulnerability

**Don't open a public issue.** Use GitHub's private reporting instead:
[Report a vulnerability](https://github.com/Thisarahetz/pos-hardware-bridge/security/advisories/new)
(Security tab → *Report a vulnerability*).

Include what you found, how to reproduce it, the bridge version (tray menu)
and operating system. You'll get a reply within a few days. Once a fix is
released, you'll be credited in the release notes unless you'd rather not be.

## Supported versions

Security fixes go into the latest release. Installed bridges update
themselves from GitHub Releases, so keeping automatic updates on is the best
protection.

## What's in scope

- The local HTTP/WebSocket API (`127.0.0.1:9191`) and its access token
- Shop-network access: pairing codes, device tokens, mDNS
- The print station connection (station tokens, job handling)
- Rendering of HTML pages sent for printing (scripts off, no network)
- The settings window and automatic updates

See [Security notes](https://thisarahetz.github.io/pos-hardware-bridge/security/)
for how the bridge is designed to be safe.
