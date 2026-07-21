import Store from 'electron-store';
import { randomBytes } from 'node:crypto';
import type { BridgeConfig } from './types';

const defaults: BridgeConfig = {
  server: {
    port: 9191,
    authToken: randomBytes(24).toString('hex'),
  },
  printer: {
    enabled: false,
    connectionType: 'usb',
    driver: 'epson',
    usb: { systemPrinterName: '' },
    network: { host: '192.168.1.100', port: 9100 },
    paperWidthChars: 42,
  },
  terminal: {
    enabled: false,
    serialPath: '',
    baudRate: 9600,
    responseTimeoutMs: 30000,
  },
};

// electron-store persists as plain JSON under the OS user-data dir; the auth token
// is a localhost-only shared secret (see server.ts), not a credential worth encrypting.
const store = new Store<BridgeConfig>({ defaults });

export function getConfig(): BridgeConfig {
  return store.store;
}

export function updateConfig(patch: Partial<BridgeConfig>): BridgeConfig {
  store.set({ ...store.store, ...patch });
  return store.store;
}

export function regenerateAuthToken(): string {
  const token = randomBytes(24).toString('hex');
  store.set('server.authToken', token);
  return token;
}

export default store;
