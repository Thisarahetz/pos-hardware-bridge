import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { BridgeConfig, BridgeStatus } from '../main/types';
import type { ConfigPatch } from '../main/config-store';
import type { DiscoveredPrinter } from '../main/printer/discovery';

type Result<T = unknown> = { ok: true; value?: T } | { ok: false; error: string };

contextBridge.exposeInMainWorld('bridge', {
  getStatus: (): Promise<BridgeStatus> => ipcRenderer.invoke('status:get'),
  refreshStatus: (): Promise<BridgeStatus> => ipcRenderer.invoke('status:refresh'),
  onStatus: (listener: (status: BridgeStatus) => void): void => {
    ipcRenderer.on('status:changed', (_evt: IpcRendererEvent, status: BridgeStatus) => listener(status));
  },
  onConfig: (listener: (config: BridgeConfig) => void): void => {
    ipcRenderer.on('config:changed', (_evt: IpcRendererEvent, config: BridgeConfig) => listener(config));
  },
  onNotice: (listener: (message: string) => void): void => {
    ipcRenderer.on('notice', (_evt: IpcRendererEvent, message: string) => listener(message));
  },

  getConfig: (): Promise<BridgeConfig> => ipcRenderer.invoke('config:get'),
  updateConfig: (patch: ConfigPatch): Promise<BridgeConfig> => ipcRenderer.invoke('config:update', patch),
  regenerateToken: (): Promise<string> => ipcRenderer.invoke('config:regenerate-token'),
  openLogs: (): Promise<void> => ipcRenderer.invoke('app:open-logs'),
  copy: (text: string): Promise<void> => ipcRenderer.invoke('clipboard:write', text),

  discoverPrinters: (): Promise<Result<DiscoveredPrinter[]>> => ipcRenderer.invoke('printers:discover'),
  scanNetwork: (): Promise<Result<DiscoveredPrinter[]>> => ipcRenderer.invoke('printers:scan-network'),
  usePrinter: (printer: DiscoveredPrinter): Promise<Result<BridgeStatus>> => ipcRenderer.invoke('printers:use', printer),
  turnOffPrinter: (): Promise<Result<BridgeStatus>> => ipcRenderer.invoke('printer:turn-off'),
  fixPrinter: (action: 'resume-queue' | 'clear-queue'): Promise<Result<BridgeStatus>> =>
    ipcRenderer.invoke('printer:fix', action),

  listSerialPorts: (includeSystemPorts?: boolean): Promise<Array<{ path: string; label: string }>> =>
    ipcRenderer.invoke('devices:list-serial-ports', includeSystemPorts),

  testPrint: (): Promise<Result> => ipcRenderer.invoke('test:print'),
  testTerminalCharge: (): Promise<Result> => ipcRenderer.invoke('test:terminal-charge'),
});
