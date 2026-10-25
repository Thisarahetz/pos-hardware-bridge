# Contributing

Thanks for helping make POS Hardware Bridge better! Bug reports, printer
compatibility notes, docs fixes and code are all welcome.

## Ways to help

- **Report a bug** — [open an issue](https://github.com/Thisarahetz/pos-hardware-bridge/issues/new/choose).
  A photo of a wrong print, the printer model and the bridge log help most.
- **Tell us your printer works** (or doesn't) — model, paper width, connection.
- **Improve the docs** — every page has an edit button (✏️) that opens the
  Markdown file on GitHub.
- **Send a pull request** — for anything bigger than a small fix, open an
  issue first so we can agree on the approach.

## Development setup

You need [Node.js 22](https://nodejs.org/) and git. A thermal printer helps
but isn't required for most changes.

```bash
git clone https://github.com/Thisarahetz/pos-hardware-bridge.git
cd pos-hardware-bridge
npm install
npm run dev:start      # rebuild on save and run the app
```

| Command | Does |
| --- | --- |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the app (after a build) |
| `npm run dev:start` | Rebuild on save and run |
| `npm test --prefix packages/sdk` | Build and test the SDK |
| `npm run dist:mac` / `dist:win` | Build an installer into `release/` |

Auto-start and automatic updates are off when running from source.

### Docs site

The docs at https://thisarahetz.github.io/pos-hardware-bridge/ are built from
`website/` with [MkDocs Material](https://squidfunk.github.io/mkdocs-material/):

```bash
python3 -m venv .venv && . .venv/bin/activate
pip install -r website/requirements.txt
mkdocs serve           # http://127.0.0.1:8000, reloads as you edit
```

The API reference (`docs/openapi.yaml`, `docs/print-station.openapi.yaml`) is
also bundled into the app and served at `http://127.0.0.1:9191/docs`.

## Project layout

```
src/main/               Electron main process
  server.ts             HTTP + WebSocket API
  validation.ts         Request checks → 400 with field-level details
  printer/
    receipt-layout.ts   Lays receipts out line by line (shared with the SDK)
    receipt-blocks.service.ts  Prints line-by-line receipts (ESC/POS / Star)
    printer.service.ts  Thermal printing, test page, HTML pages
    document.service.ts A4/A5 printing through the OS driver
    cups-backend.ts     macOS/Linux print system
    windows-backend.ts  Windows print spooler
  cloud/                Print station client (prints jobs from a POS backend)
  lan/                  Shop-network pairing and mDNS
  terminal/             Serial card-terminal driver
src/renderer/settings/  Settings window (plain HTML/JS)
packages/sdk/           The `pos-hardware-bridge` npm package
docs/                   OpenAPI specs (bundled into the app)
website/                Docs site source
```

## Rules of the road

- **Receipt layout is shared.** `src/main/printer/receipt-layout.ts` and
  `packages/sdk/src/layout.ts` must stay identical (CI checks). Edit the
  bridge's copy and run `cp src/main/printer/receipt-layout.ts packages/sdk/src/layout.ts`.
- **API changes** update `docs/openapi.yaml`, the website and, when relevant,
  the SDK — and stay backwards compatible: shops run POS versions you can't
  upgrade.
- **Messages are for cashiers.** Errors and statuses shown in the app or
  returned by the API should say what happened and what to do, in plain words.
- **Test on real paper** for printing changes, and say which printer and
  paper width you used in the PR.
- Keep pull requests focused. Write commit messages that say what changed and
  why.

## Releases

Maintainers release by bumping the version and pushing a tag:

```bash
npm version 1.2.0 --no-git-tag-version
git commit -am "Release 1.2.0" && git tag v1.2.0 && git push --follow-tags
```

The *Build Windows installer* workflow publishes the installer to GitHub
Releases, which installed bridges update from.

By contributing you agree that your contributions are licensed under the
[MIT License](https://github.com/Thisarahetz/pos-hardware-bridge/blob/master/LICENSE) and you'll follow the [code of conduct](https://github.com/Thisarahetz/pos-hardware-bridge/blob/master/CODE_OF_CONDUCT.md).
