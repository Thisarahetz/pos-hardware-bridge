import { app, BrowserWindow, Menu, Tray, nativeImage } from 'electron';
import path from 'node:path';
import { registerIpcHandlers } from './ipc-handlers';
import { startServer, stopServer } from './server';
import { getConfig } from './config-store';

let tray: Tray | null = null;
let settingsWindow: BrowserWindow | null = null;
let isQuitting = false;

function createSettingsWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 640,
    height: 720,
    title: 'POS Hardware Bridge — Settings',
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
  return win;
}

function showSettingsWindow(): void {
  if (!settingsWindow || settingsWindow.isDestroyed()) {
    settingsWindow = createSettingsWindow();
  }
  settingsWindow.show();
  settingsWindow.focus();
}

function createTray(): void {
  // Placeholder icon — swap for a real .png/.ico asset before shipping a build.
  tray = new Tray(nativeImage.createEmpty());
  tray.setToolTip('POS Hardware Bridge');
  const rebuildMenu = () => {
    const port = getConfig().server.port;
    tray?.setContextMenu(
      Menu.buildFromTemplate([
        { label: `Listening on 127.0.0.1:${port}`, enabled: false },
        { type: 'separator' },
        { label: 'Settings…', click: showSettingsWindow },
        { type: 'separator' },
        {
          label: 'Quit',
          click: () => {
            isQuitting = true;
            app.quit();
          },
        },
      ]),
    );
  };
  rebuildMenu();
}

app.whenReady().then(() => {
  startServer();
  createTray();
  settingsWindow = createSettingsWindow();
  registerIpcHandlers(settingsWindow);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      settingsWindow = createSettingsWindow();
    } else {
      showSettingsWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // Tray-resident app: don't quit when the settings window closes.
});

app.on('before-quit', () => {
  isQuitting = true;
  stopServer();
});
