import { contextBridge, ipcRenderer } from 'electron';
import type { BridgeConfig } from '../main/types';

contextBridge.exposeInMainWorld('bridge', {
  getConfig: (): Promise<BridgeConfig> => ipcRenderer.invoke('config:get'),
  updateConfig: (patch: Partial<BridgeConfig>): Promise<BridgeConfig> =>
    ipcRenderer.invoke('config:update', patch),
  regenerateToken: (): Promise<string> => ipcRenderer.invoke('config:regenerate-token'),
  listSerialPorts: (): Promise<Array<{ path: string; manufacturer?: string }>> =>
    ipcRenderer.invoke('devices:list-serial-ports'),
  listSystemPrinters: (): Promise<Array<{ name: string }>> =>
    ipcRenderer.invoke('devices:list-system-printers'),
  testPrint: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('test:print'),
  testTerminalCharge: (): Promise<unknown> => ipcRenderer.invoke('test:terminal-charge'),
});
