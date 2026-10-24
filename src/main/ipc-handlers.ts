import { app, clipboard, ipcMain, shell } from 'electron';
import { log } from './logger';
import { getConfig, updateConfig, regenerateAuthToken, type ConfigPatch } from './config-store';
import { restartServer } from './server';
import { printTestPage } from './printer/printer.service';
import { discoverPrinters, scanNetworkPrinters, type DiscoveredPrinter } from './printer/discovery';
import { getBackend } from './printer/backend';
import { usePrinter } from './printer/setup';
import { charge, listSerialPorts, resetTerminalConnection } from './terminal/terminal.service';
import { getStatus, refreshStatus } from './status-monitor';
import { applyLaunchAtLogin } from './autostart';

type Result<T = undefined> = { ok: true; value?: T } | { ok: false; error: string };

async function attempt<T>(fn: () => Promise<T> | T): Promise<Result<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function registerIpcHandlers(): void {
  ipcMain.handle('status:get', async () => getStatus() ?? refreshStatus());
  ipcMain.handle('status:refresh', () => refreshStatus());

  ipcMain.handle('config:get', () => getConfig());

  ipcMain.handle('config:update', async (_evt, patch: ConfigPatch) => {
    const before = getConfig();
    const next = updateConfig(patch);
    if (patch.server && before.server.port !== next.server.port) restartServer();
    if (patch.terminal) resetTerminalConnection();
    if (patch.app) applyLaunchAtLogin();
    void refreshStatus();
    return next;
  });

  ipcMain.handle('config:regenerate-token', () => regenerateAuthToken());
  ipcMain.handle('app:open-logs', () => shell.openPath(log.dir() ?? app.getPath('logs')));
  ipcMain.handle('clipboard:write', (_evt, text: string) => clipboard.writeText(String(text)));

  ipcMain.handle('printers:discover', () => attempt(discoverPrinters));
  ipcMain.handle('printers:scan-network', () => attempt(() => scanNetworkPrinters()));

  ipcMain.handle('printers:use', (_evt, printer: DiscoveredPrinter) =>
    attempt(async () => {
      await usePrinter(printer);
      return refreshStatus();
    }),
  );

  ipcMain.handle('printer:turn-off', () =>
    attempt(async () => {
      updateConfig({ printer: { enabled: false, autoDetect: false } });
      return refreshStatus();
    }),
  );

  ipcMain.handle('printer:fix', (_evt, action: 'resume-queue' | 'clear-queue') =>
    attempt(async () => {
      const name = getConfig().printer.usb.systemPrinterName;
      if (!name) throw new Error('No printer selected.');
      if (action === 'resume-queue') await getBackend().resume(name);
      if (action === 'clear-queue') await getBackend().clear(name);
      return refreshStatus();
    }),
  );

  ipcMain.handle('devices:list-serial-ports', (_evt, includeSystemPorts?: boolean) =>
    listSerialPorts({ includeSystemPorts: Boolean(includeSystemPorts) }),
  );

  ipcMain.handle('test:print', () => attempt(printTestPage));

  ipcMain.handle('test:terminal-charge', () =>
    attempt(() => charge({ amountMinorUnits: 100, currency: 'USD', reference: `test-${Date.now()}` })),
  );
}
