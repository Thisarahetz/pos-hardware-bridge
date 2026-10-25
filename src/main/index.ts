import { app, BrowserWindow, clipboard, Menu, Notification, powerMonitor, powerSaveBlocker, shell, Tray } from 'electron';
import path from 'node:path';
import { registerIpcHandlers } from './ipc-handlers';
import { startServer, stopServer } from './server';
import { getConfig, updateConfig } from './config-store';
import { applyLaunchAtLogin, startedAtLogin } from './autostart';
import { log } from './logger';
import { checkForUpdates, getUpdateState, installUpdateNow, startAutoUpdates, updateEvents } from './updater';
import { cloudEvents, getCloudState, kickCloud, startCloud, type CloudState } from './cloud/cloud-client';
import { printTestPage } from './printer/printer.service';
import { refreshStatus, startStatusMonitor, statusEvents, stopStatusMonitor } from './status-monitor';
import { trayIcon } from './tray-icon';
import { lanEvents, type LanState } from './lan/devices';
import type { BridgeStatus, DeviceStatus, PrinterProfile, StatusLevel } from './types';

let tray: Tray | null = null;
let settingsWindow: BrowserWindow | null = null;
let isQuitting = false;
let lastStatus: BridgeStatus | null = null;
let trayMenu: Menu | null = null;
const readyWindows = new WeakSet<BrowserWindow>();
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
  win.once('ready-to-show', () => readyWindows.add(win));
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

function revealWindow(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  // macOS: with the Dock icon hidden the app isn't active, so a plain show()
  // leaves the window behind everything else. Bring the app to the front.
  if (process.platform === 'darwin') app.focus({ steal: true });
  win.focus();
}

function showSettingsWindow(): void {
  if (!settingsWindow || settingsWindow.isDestroyed()) {
    settingsWindow = createSettingsWindow();
  }
  const win = settingsWindow;
  // 'ready-to-show' fires only once per window, so only wait for it on a
  // window that hasn't painted yet.
  if (!readyWindows.has(win)) {
    win.once('ready-to-show', () => revealWindow(win));
    return;
  }
  if (process.platform === 'darwin' && app.dock) {
    void app.dock.show().then(() => revealWindow(win));
  } else {
    revealWindow(win);
  }
}

function sendToWindow(channel: string, payload: unknown): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.webContents.send(channel, payload);
}

function notify(title: string, body: string): void {
  if (Notification.isSupported()) new Notification({ title, body, silent: false }).show();
}

function overallLevel(status: BridgeStatus): StatusLevel {
  const levels = [status.printer.level, ...status.printers.map((p) => p.level), status.terminal.level];
  if (levels.includes('error')) return 'error';
  if (levels.includes('warning')) return 'warning';
  if (levels.includes('ok')) return 'ok';
  return 'off';
}

async function testPrint(id: string): Promise<void> {
  try {
    await printTestPage(id);
  } catch (err) {
    notify('Test print failed', err instanceof Error ? err.message : String(err));
  }
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
    if (status.printers.length === 0) {
      items.push({ label: deviceLine('Printer', status.printer), click: showSettingsWindow });
    }
    for (const p of status.printers) {
      items.push({
        label: deviceLine(p.name, p),
        submenu: [
          { label: p.detail, enabled: false },
          { label: `API name: ${p.id}`, enabled: false },
          { type: 'separator' },
          {
            label: 'Print test page',
            enabled: p.level === 'ok' || p.level === 'warning',
            click: () => void testPrint(p.id),
          },
        ],
      });
    }
    items.push({ label: deviceLine('Card terminal', status.terminal), click: showSettingsWindow });
  } else {
    items.push({ label: 'Checking devices…', enabled: false });
  }
  const cloud = getCloudState();
  if (cloud.state !== 'off') {
    const cloudDot = cloud.state === 'connected' ? DOT.ok : cloud.state === 'connecting' ? DOT.warning : DOT.error;
    const cloudText =
      cloud.state === 'connected' ? `printing for ${cloud.shopName}`
      : cloud.state === 'connecting' ? 'connecting…'
      : cloud.state === 'removed' ? 'removed, connect again'
      : 'offline, retrying';
    items.push({ label: `${cloudDot}  Online POS: ${cloudText}`, click: showSettingsWindow });
  }
  items.push(
    { type: 'separator' },
    { label: 'Open settings…', click: showSettingsWindow },
    { label: 'Copy POS password', click: () => clipboard.writeText(getConfig().server.authToken) },
    {
      label: status?.api.running === false ? `⚠️  Not running: ${status.api.error ?? ''}` : `Address: http://127.0.0.1:${port}`,
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
    updateMenuItem(),
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  );
  trayMenu = Menu.buildFromTemplate(items);
  // macOS: setContextMenu would swallow left clicks, so the menu is opened by
  // hand on right click instead (see createTray).
  if (process.platform !== 'darwin') tray.setContextMenu(trayMenu);
}

function updateMenuItem(): Electron.MenuItemConstructorOptions {
  const u = getUpdateState();
  const version = `v${app.getVersion()}`;
  if (u.state === 'ready') return { label: `Restart to update to v${u.version}`, click: installUpdateNow };
  if (u.state === 'downloading') return { label: `Downloading update v${u.version}… ${u.percent}%`, enabled: false };
  if (u.state === 'checking') return { label: `${version} · checking for updates…`, enabled: false };
  return {
    label: `${version} · ${u.state === 'up-to-date' ? 'up to date' : 'check for updates'}`,
    enabled: app.isPackaged,
    click: () => void checkForUpdates(),
  };
}

function createTray(): void {
  tray = new Tray(trayIcon('off'));
  // Left click opens settings; right click (or Ctrl-click on macOS) shows the menu.
  tray.on('click', (event) => {
    if (process.platform === 'darwin' && event.ctrlKey && trayMenu) tray?.popUpContextMenu(trayMenu);
    else showSettingsWindow();
  });
  if (process.platform === 'darwin') {
    tray.on('right-click', () => {
      if (trayMenu) tray?.popUpContextMenu(trayMenu);
    });
  }
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
        if (overallLevel(status) !== 'ok' || status.printers.length === 0) showSettingsWindow();
      } else {
        // Started with the computer: the printer may still be warming up, so
        // give it a moment before warning anyone.
        setTimeout(() => {
          const s = lastStatus;
          if (!s) return;
          if (s.printers.length === 0) notify(`POS printer: ${s.printer.title}`, s.printer.steps[0] ?? s.printer.detail);
          for (const p of s.printers) {
            if (p.level === 'error') notify(`${p.name}: ${p.title}`, p.steps[0] ?? p.detail);
          }
        }, 30000);
      }
      return;
    }
    // Tell the cashier when any printer drops out or comes back.
    for (const p of status.printers) {
      const was = previous?.printers.find((x) => x.id === p.id)?.level;
      if (was === 'ok' && p.level === 'error') notify(`${p.name}: ${p.title}`, p.detail);
      if (was && was !== 'ok' && p.level === 'ok') notify(`${p.name} ready`, p.detail);
    }
  });

  statusEvents.on('auto-setup', (printer: PrinterProfile) => {
    const message = `Found a receipt printer and set it up as “${printer.name}”.`;
    notify('Printer connected', message);
    sendToWindow('notice', message);
  });

  statusEvents.on('auto-setup-failed', (message: string) => {
    sendToWindow('notice', `Found a printer but couldn’t set it up automatically: ${message}`);
  });

  cloudEvents.on('state', (cloud: CloudState) => {
    rebuildTray();
    sendToWindow('cloud:state', cloud);
  });
  lanEvents.on('changed', (lan: LanState) => sendToWindow('lan:changed', lan));

  cloudEvents.on('removed', (shop: string) => {
    notify('Disconnected from your POS', `This computer no longer prints for ${shop}. Get a new code in your POS and connect again.`);
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
    startCloud();
    startAutoUpdates();
    updateEvents.on('state', (u) => {
      rebuildTray();
      if (u.state === 'ready') notify('Update ready', `Version ${u.version} installs the next time the bridge restarts.`);
    });

    app.on('activate', showSettingsWindow);

    // After sleep or a locked screen, devices may have changed: re-check right away.
    powerMonitor.on('resume', () => {
      log.info('power event: resume');
      void refreshStatus();
      kickCloud();
    });
    powerMonitor.on('unlock-screen', () => {
      void refreshStatus();
      kickCloud();
    });
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
