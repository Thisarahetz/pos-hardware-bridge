import { app, clipboard, ipcMain, shell } from 'electron';
import { log } from './logger';
import os from 'node:os';
import { disconnectStation, getCloudState, pairStation } from './cloud/cloud-client';
import {
  getConfig,
  makeDefaultPrinter,
  regenerateAuthToken,
  removePrinter,
  renamePrinterId,
  updateConfig,
  updatePrinter,
  type ConfigPatch,
} from './config-store';
import { restartServer } from './server';
import { printTestPage } from './printer/printer.service';
import { discoverPrinters, scanNetworkPrinters, type DiscoveredPrinter } from './printer/discovery';
import { getBackend } from './printer/backend';
import { addDiscoveredPrinter, type AddPrinterOptions } from './printer/setup';
import type { PrinterProfile } from './types';
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

  ipcMain.handle('printers:add', (_evt, printer: DiscoveredPrinter, options: AddPrinterOptions) =>
    attempt(async () => {
      const profile = await addDiscoveredPrinter(printer, options);
      void refreshStatus();
      return profile;
    }),
  );

  ipcMain.handle('printers:update', (_evt, id: string, patch: Partial<PrinterProfile>) =>
    attempt(async () => {
      const { id: newId, connection: _ignored, ...rest } = patch;
      updatePrinter(id, rest);
      if (newId && newId !== id) renamePrinterId(id, newId);
      void refreshStatus();
      return getConfig();
    }),
  );

  ipcMain.handle('printers:remove', (_evt, id: string) =>
    attempt(async () => {
      removePrinter(id);
      // Don't immediately re-add the printer the operator just removed.
      updateConfig({ app: { autoDetectPrinters: false } });
      void refreshStatus();
      return getConfig();
    }),
  );

  ipcMain.handle('printers:make-default', (_evt, id: string) =>
    attempt(async () => {
      makeDefaultPrinter(id);
      void refreshStatus();
      return getConfig();
    }),
  );

  ipcMain.handle('printers:fix', (_evt, id: string, action: 'resume-queue' | 'clear-queue') =>
    attempt(async () => {
      const profile = getConfig().printers.find((p) => p.id === id);
      if (!profile || profile.connection.type !== 'system') throw new Error('This printer has no print queue to fix.');
      const queue = profile.connection.queueName;
      if (action === 'resume-queue') await getBackend().resume(queue);
      if (action === 'clear-queue') await getBackend().clear(queue);
      return refreshStatus();
    }),
  );

  ipcMain.handle('devices:list-serial-ports', (_evt, includeSystemPorts?: boolean) =>
    listSerialPorts({ includeSystemPorts: Boolean(includeSystemPorts) }),
  );

  ipcMain.handle('test:print', (_evt, id?: string) => attempt(() => printTestPage(id)));

  ipcMain.handle('cloud:get', () => getCloudState());
  ipcMain.handle('cloud:pair', (_evt, serverUrl: string, code: string, name: string) =>
    attempt(() => pairStation(String(serverUrl ?? ''), String(code ?? ''), String(name ?? ''))),
  );
  ipcMain.handle('cloud:disconnect', () => attempt(disconnectStation));
  ipcMain.handle('cloud:default-name', () => os.hostname().replace(/\.local$/, ''));

  ipcMain.handle('test:terminal-charge', () =>
    attempt(() => charge({ amountMinorUnits: 100, currency: 'USD', reference: `test-${Date.now()}` })),
  );
}
