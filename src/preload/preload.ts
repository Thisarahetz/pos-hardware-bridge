import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { BridgeConfig, BridgeStatus, PrinterKind, PrinterProfile } from '../main/types';
import type { ConfigPatch } from '../main/config-store';
import type { DiscoveredPrinter } from '../main/printer/discovery';
import type { CloudState } from '../main/cloud/cloud-client';
import type { LanState, PairingCode } from '../main/lan/devices';

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
  openDocs: (): Promise<void> => ipcRenderer.invoke('app:open-docs'),
  copy: (text: string): Promise<void> => ipcRenderer.invoke('clipboard:write', text),

  discoverPrinters: (): Promise<Result<DiscoveredPrinter[]>> => ipcRenderer.invoke('printers:discover'),
  scanNetwork: (): Promise<Result<DiscoveredPrinter[]>> => ipcRenderer.invoke('printers:scan-network'),
  addPrinter: (printer: DiscoveredPrinter, options: { kind: PrinterKind; name?: string; id?: string }): Promise<Result<PrinterProfile>> =>
    ipcRenderer.invoke('printers:add', printer, options),
  updatePrinter: (id: string, patch: Partial<PrinterProfile>): Promise<Result<BridgeConfig>> =>
    ipcRenderer.invoke('printers:update', id, patch),
  removePrinter: (id: string): Promise<Result<BridgeConfig>> => ipcRenderer.invoke('printers:remove', id),
  makeDefaultPrinter: (id: string): Promise<Result<BridgeConfig>> => ipcRenderer.invoke('printers:make-default', id),
  fixPrinter: (id: string, action: 'resume-queue' | 'clear-queue'): Promise<Result<BridgeStatus>> =>
    ipcRenderer.invoke('printers:fix', id, action),

  listSerialPorts: (includeSystemPorts?: boolean): Promise<Array<{ path: string; label: string }>> =>
    ipcRenderer.invoke('devices:list-serial-ports', includeSystemPorts),

  testPrint: (id?: string): Promise<Result> => ipcRenderer.invoke('test:print', id),

  getCloud: (): Promise<CloudState> => ipcRenderer.invoke('cloud:get'),
  onCloud: (listener: (state: CloudState) => void): void => {
    ipcRenderer.on('cloud:state', (_evt: IpcRendererEvent, s: CloudState) => listener(s));
  },
  pairCloud: (serverUrl: string, code: string, name: string): Promise<Result<CloudState>> =>
    ipcRenderer.invoke('cloud:pair', serverUrl, code, name),
  disconnectCloud: (): Promise<Result<CloudState>> => ipcRenderer.invoke('cloud:disconnect'),
  defaultStationName: (): Promise<string> => ipcRenderer.invoke('cloud:default-name'),
  testTerminalCharge: (): Promise<Result> => ipcRenderer.invoke('test:terminal-charge'),

  getLan: (): Promise<LanState> => ipcRenderer.invoke('lan:get'),
  onLan: (listener: (state: LanState) => void): void => {
    ipcRenderer.on('lan:changed', (_evt: IpcRendererEvent, s: LanState) => listener(s));
  },
  setLanEnabled: (enabled: boolean): Promise<Result<LanState>> => ipcRenderer.invoke('lan:set-enabled', enabled),
  startPairing: (): Promise<Result<PairingCode>> => ipcRenderer.invoke('lan:start-pairing'),
  cancelPairing: (): Promise<Result> => ipcRenderer.invoke('lan:cancel-pairing'),
  removeDevice: (id: string): Promise<Result> => ipcRenderer.invoke('lan:remove-device', id),
  renameDevice: (id: string, name: string): Promise<Result> => ipcRenderer.invoke('lan:rename-device', id, name),
});
