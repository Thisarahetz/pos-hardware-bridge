import { app } from 'electron';
import { EventEmitter } from 'node:events';
import { autoUpdater } from 'electron-updater';
import { log } from './logger';

/**
 * Automatic updates from this project's GitHub Releases (see `build.publish`
 * in package.json). The bridge downloads a new version in the background and
 * installs it the next time it quits or the computer restarts — it never
 * restarts itself in the middle of the shop's day.
 */

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

export type UpdateState =
  | { state: 'idle' | 'checking' | 'up-to-date' }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'ready'; version: string }
  | { state: 'error'; message: string };

export const updateEvents = new EventEmitter();
let current: UpdateState = { state: 'idle' };
let timer: NodeJS.Timeout | null = null;

function set(next: UpdateState): void {
  current = next;
  updateEvents.emit('state', next);
}

export function getUpdateState(): UpdateState {
  return current;
}

export async function checkForUpdates(): Promise<UpdateState> {
  if (!app.isPackaged) {
    set({ state: 'up-to-date' });
    return current;
  }
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    // Offline or GitHub unreachable: try again at the next check, quietly.
    log.warn('update check failed', err);
    set({ state: 'error', message: 'Could not check for updates. Will try again later.' });
  }
  return current;
}

/** Install the downloaded update now (restarts the bridge). */
export function installUpdateNow(): void {
  if (current.state === 'ready') autoUpdater.quitAndInstall(true, true);
}

export function startAutoUpdates(): void {
  if (!app.isPackaged || timer) return;
  autoUpdater.logger = { info: (m: unknown) => log.info('updater', m), warn: (m: unknown) => log.warn('updater', m), error: (m: unknown) => log.error('updater', m), debug: () => undefined };
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => set({ state: 'checking' }));
  autoUpdater.on('update-not-available', () => set({ state: 'up-to-date' }));
  autoUpdater.on('update-available', (info) => set({ state: 'downloading', version: info.version, percent: 0 }));
  autoUpdater.on('download-progress', (p) => {
    if (current.state === 'downloading') set({ ...current, percent: Math.round(p.percent) });
  });
  autoUpdater.on('update-downloaded', (info) => {
    log.info(`update ${info.version} downloaded; installs on next restart`);
    set({ state: 'ready', version: info.version });
  });
  autoUpdater.on('error', (err) => {
    log.warn('updater error', err);
    set({ state: 'error', message: 'Could not download the update. Will try again later.' });
  });
  // First check shortly after start, then every 6 hours.
  setTimeout(() => void checkForUpdates(), 30_000).unref();
  timer = setInterval(() => void checkForUpdates(), CHECK_EVERY_MS);
  timer.unref();
}
