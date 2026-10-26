# Install

Install the bridge on the computer the printers are plugged into (the *shop
computer*). Your POS can run on the same computer or on other devices.

## Download

[Download for Windows](https://github.com/Thisarahetz/pos-hardware-bridge/releases/latest/download/POS-Hardware-Bridge-Setup.exe){ .md-button .md-button--primary }
[All releases](https://github.com/Thisarahetz/pos-hardware-bridge/releases/latest){ .md-button }

The Windows button always downloads the newest installer. Other builds and
release notes are on [GitHub Releases](https://github.com/Thisarahetz/pos-hardware-bridge/releases/latest).

=== "Windows 10/11"

    1. Run `POS-Hardware-Bridge-Setup.exe`. It installs for the
       current user (no admin needed), adds desktop and Start-menu shortcuts,
       and starts the bridge.
    2. If Windows SmartScreen warns about an unknown publisher, click
       **More info → Run anyway**. The installer isn't code-signed yet.

=== "macOS"

    Open the `.dmg`, drag **POS Hardware Bridge** to Applications, then open it.

    !!! note
        macOS builds aren't code-signed yet, so they don't update themselves.
        Install new versions by hand from Releases.

=== "Linux / from source"

    There's no packaged Linux build yet. Run it from source:

    ```bash
    git clone https://github.com/Thisarahetz/pos-hardware-bridge.git
    cd pos-hardware-bridge
    npm install
    npm run build && npm start
    ```

    You need [Node.js 22](https://nodejs.org/) and CUPS (`lpstat`, `lp`).

## After installing

- The bridge **starts with the computer** and lives in the tray (Windows) or
  menu bar (macOS). Closing the settings window doesn't stop it.
  To turn auto-start off: tray icon → untick **Start with computer**.
- **Updates install themselves** (Windows): the bridge checks GitHub Releases
  30 seconds after starting and every 6 hours, downloads in the background,
  and installs the next time it or the computer restarts. The tray shows the
  version and **Restart to update** when one is ready.

Next: [set up your printers](setup.md).
