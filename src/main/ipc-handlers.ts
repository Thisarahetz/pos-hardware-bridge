import { ipcMain, type BrowserWindow } from 'electron';
import { getConfig, updateConfig, regenerateAuthToken } from './config-store';
import { restartServer } from './server';
import { printTestPage } from './printer/printer.service';
import { charge, listSerialPorts } from './terminal/terminal.service';
import { resetTerminalConnection } from './terminal/terminal.service';
import type { BridgeConfig } from './types';

export function registerIpcHandlers(settingsWindow: BrowserWindow): void {
  ipcMain.handle('devices:list-system-printers', async () => {
    return settingsWindow.webContents.getPrintersAsync();
  });

  ipcMain.handle('config:get', () => getConfig());

  ipcMain.handle('config:update', (_evt, patch: Partial<BridgeConfig>) => {
    const next = updateConfig(patch);
    resetTerminalConnection();
    restartServer();
    return next;
  });

  ipcMain.handle('config:regenerate-token', () => {
    const token = regenerateAuthToken();
    restartServer();
    return token;
  });

  ipcMain.handle('devices:list-serial-ports', () => listSerialPorts());

  ipcMain.handle('test:print', async () => {
    try {
      await printTestPage();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('test:terminal-charge', async () => {
    return charge({ amountMinorUnits: 100, currency: 'USD', reference: `test-${Date.now()}` });
  });
}
