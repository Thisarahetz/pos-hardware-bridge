import { app, BrowserWindow, clipboard, Menu, Notification, powerMonitor, powerSaveBlocker, shell, Tray } from 'electron';
import path from 'node:path';
import { registerIpcHandlers } from './ipc-handlers';
import { startServer, stopServer } from './server';
import { getConfig, updateConfig } from './config-store';
import { applyLaunchAtLogin, startedAtLogin } from './autostart';
import { log } from './logger';
import { printTestPage } from './printer/printer.service';
import type { DiscoveredPrinter } from './printer/discovery';
import { refreshStatus, startStatusMonitor, statusEvents, stopStatusMonitor } from './status-monitor';
import { trayIcon } from './tray-icon';
import type { BridgeStatus, DeviceStatus, StatusLevel } from './types';

let tray: Tray | null = null;
let settingsWindow: BrowserWindow | null = null;
let isQuitting = false;
let lastStatus: BridgeStatus | null = null;
const launchedHidden = startedAtLogin();

// Never let an unexpected error kill the bridge or pop up a dialog that blocks
// the till; log it and keep serving.
process.on('uncaughtException', (err) => log.error('uncaught exception', err));
process.on('unhandledRejection', (reason) => log.error('unhandled rejection', reason));

const DOT: Record<StatusLevel, string> = { ok: '🟢', warning: '🟡', error: '🔴', off: '⚪️' };

function createSettingsWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 720,
    height: 820,
    minWidth: 520,
    minHeight: 560,
    show: false,
    title: 'POS Hardware Bridge',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, '../../src/renderer/settings/index.html'));
  win.on('close', (event) => {
    // Hide instead of quit — the bridge keeps serving the local API from the tray.
    if (!isQuitting) {
      event.preventDefault();
      win.hide();
    }
  });
  // macOS: behave like a menu-bar app — Dock icon only while the window is open.
  win.on('hide', () => app.dock?.hide());
  win.on('show', () => void app.dock?.show());
  win.webContents.on('render-process-gone', (_evt, details) => {
    log.error('settings window crashed', details.reason);
    if (details.reason !== 'clean-exit' && !win.isDestroyed()) win.webContents.reload();
  });
  return win;
}

function showSettingsWindow(): void {
  if (!settingsWindow || settingsWindow.isDestroyed()) {
    settingsWindow = createSettingsWindow();
  }
  if (settingsWindow.webContents.isLoading()) {
    settingsWindow.once('ready-to-show', () => settingsWindow?.show());
  } else {
    settingsWindow.show();
  }
  settingsWindow.focus();
}

function sendToWindow(channel: string, payload: unknown): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.webContents.send(channel, payload);
}

function notify(title: string, body: string): void {
  if (Notification.isSupported()) new Notification({ title, body, silent: false }).show();
}

function overallLevel(status: BridgeStatus): StatusLevel {
  const levels = [status.printer.level, status.terminal.level];
  if (levels.includes('error')) return 'error';
  if (levels.includes('warning')) return 'warning';
  if (levels.includes('ok')) return 'ok';
  return 'off';
}

function deviceLine(name: string, s: DeviceStatus): string {
  return `${DOT[s.level]}  ${name}: ${s.title}`;
}

function rebuildTray(status: BridgeStatus | null = lastStatus): void {
  lastStatus = status;
  if (!tray) return;
  const port = getConfig().server.port;
  const level = status ? overallLevel(status) : 'off';
  tray.setImage(trayIcon(level));
  tray.setToolTip(status ? `POS Hardware Bridge — ${status.printer.title}` : 'POS Hardware Bridge — starting…');

  const items: Electron.MenuItemConstructorOptions[] = [
    { label: 'POS Hardware Bridge', enabled: false },
    { type: 'separator' },
  ];
  if (status) {
    items.push(
      { label: deviceLine('Printer', status.printer), click: showSettingsWindow },
      ...(status.printer.detail ? [{ label: `      ${status.printer.detail}`, enabled: false }] : []),
      { label: deviceLine('Card terminal', status.terminal), click: showSettingsWindow },
    );
  } else {
    items.push({ label: 'Checking devices…', enabled: false });
  }
  items.push(
    { type: 'separator' },
    {
      label: 'Print test page',
      enabled: status?.printer.level === 'ok' || status?.printer.level === 'warning',
      click: async () => {
        try {
          await printTestPage();
        } catch (err) {
          notify('Test print failed', err instanceof Error ? err.message : String(err));
        }
      },
    },
    { label: 'Open settings…', click: showSettingsWindow },
    { label: 'Copy API token', click: () => clipboard.writeText(getConfig().server.authToken) },
    {
      label: status?.api.running === false ? `⚠️  API not running — ${status.api.error ?? ''}` : `API: http://127.0.0.1:${port}`,
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Start with computer',
      type: 'checkbox',
      checked: getConfig().app.launchAtLogin,
      click: (item) => {
        updateConfig({ app: { launchAtLogin: item.checked } });
        applyLaunchAtLogin();
        sendToWindow('config:changed', getConfig());
      },
    },
    { label: 'Open log folder', click: () => void shell.openPath(log.dir() ?? app.getPath('logs')) },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  );
  tray.setContextMenu(Menu.buildFromTemplate(items));
}

function createTray(): void {
  tray = new Tray(trayIcon('off'));
  // Windows/Linux: left click opens settings (macOS always shows the menu).
  if (process.platform !== 'darwin') tray.on('click', showSettingsWindow);
  rebuildTray(null);
}

function watchStatus(): void {
  let firstCheck = true;
  statusEvents.on('change', (status: BridgeStatus, previous: BridgeStatus | null) => {
    rebuildTray(status);
    sendToWindow('status:changed', status);

    if (firstCheck) {
      firstCheck = false;
      if (!launchedHidden) {
        // Opened by hand: only show the window when something needs attention.
        if (status.printer.level !== 'ok') showSettingsWindow();
      } else {
        // Started with the computer: the printer may still be warming up, so
        // give it a moment before warning anyone.
        setTimeout(() => {
          const p = lastStatus?.printer;
          if (p && (p.level === 'error' || p.level === 'off')) notify(`POS printer: ${p.title}`, p.steps[0] ?? p.detail);
        }, 30000);
      }
      return;
    }
    const was = previous?.printer.level;
    const now = status.printer.level;
    if (was === 'ok' && now === 'error') notify(status.printer.title, status.printer.detail);
    if (was && was !== 'ok' && now === 'ok') notify('Printer ready', status.printer.detail);
  });

  statusEvents.on('auto-setup', (printer: DiscoveredPrinter) => {
    const message = `Found “${printer.label}” and set it up as the receipt printer.`;
    notify('Printer connected', message);
    sendToWindow('notice', message);
  });

  statusEvents.on('auto-setup-failed', (message: string) => {
    sendToWindow('notice', `Found a printer but couldn’t set it up automatically: ${message}`);
  });
}

if (!app.requestSingleInstanceLock()) {
  // A second launch just focuses the running bridge instead of fighting over the port.
  app.quit();
} else {
  app.on('second-instance', showSettingsWindow);

  app.whenReady().then(() => {
    app.setAppUserModelId('com.local.pos-hardware-bridge');
    log.info(`starting v${app.getVersion()} on ${process.platform}${launchedHidden ? ' (at login)' : ''}`);
    applyLaunchAtLogin();
    // Stop the OS from suspending the bridge while the till is idle.
    powerSaveBlocker.start('prevent-app-suspension');
    registerIpcHandlers();
    startServer();
    createTray();
    settingsWindow = createSettingsWindow();
    watchStatus();
    startStatusMonitor();

    app.on('activate', showSettingsWindow);

    // After sleep or a locked screen, devices may have changed: re-check right away.
    powerMonitor.on('resume', () => {
      log.info('power event: resume');
      void refreshStatus();
    });
    powerMonitor.on('unlock-screen', () => void refreshStatus());
  });

  app.on('child-process-gone', (_evt, details) => log.warn('child process gone', details.type, details.reason));
}

app.on('window-all-closed', () => {
  // Tray-resident app: don't quit when the settings window closes.
});

app.on('before-quit', () => {
  isQuitting = true;
  stopStatusMonitor();
  stopServer();
  if (process.platform === 'win32') {
    (require('./printer/windows-backend') as typeof import('./printer/windows-backend')).stopWindowsWorker();
  }
});
