import { app, BrowserWindow, dialog } from 'electron';
import { EventEmitter } from 'node:events';
import { autoUpdater } from 'electron-updater';
import { log } from './logger';

/**
 * Automatic updates from this project's GitHub Releases (see `build.publish`
 * in package.json). When an update is detected, an update popup is shown with
 * an option to update now or later. When the operator chooses to update, the
 * bridge downloads the update and prompts to restart and apply it.
 */

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

export type UpdateState =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'up-to-date'; version?: string }
  | { state: 'available'; version: string; releaseNotes?: string; releaseDate?: string }
  | { state: 'downloading'; version: string; percent: number; bytesPerSecond?: number }
  | { state: 'ready'; version: string }
  | { state: 'error'; message: string };

export const updateEvents = new EventEmitter();
let current: UpdateState = { state: 'idle' };
let timer: NodeJS.Timeout | null = null;
let isManualCheck = false;
let isPromptShowing = false;
let dismissedVersion: string | null = null;
let activeWindowProvider: (() => BrowserWindow | null) | null = null;
let onBeforeInstall: (() => void) | null = null;

function set(next: UpdateState): void {
  current = next;
  updateEvents.emit('state', next);
}

export function getUpdateState(): UpdateState {
  return current;
}

export function setUpdaterWindowProvider(provider: () => BrowserWindow | null): void {
  activeWindowProvider = provider;
}

export function setBeforeInstallHandler(fn: () => void): void {
  onBeforeInstall = fn;
}

function getWindowForDialog(): BrowserWindow | undefined {
  if (activeWindowProvider) {
    const win = activeWindowProvider();
    if (win && !win.isDestroyed() && win.isVisible()) return win;
  }
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && !focused.isDestroyed() && focused.isVisible()) return focused;
  return undefined;
}

function activateAppForDialog(): void {
  if (process.platform === 'darwin' && app.dock) {
    void app.dock.show();
  }
  app.focus({ steal: true });
}

function formatReleaseNotes(notes: unknown): string | undefined {
  if (typeof notes === 'string') {
    return notes.replace(/<[^>]*>?/gm, '').trim();
  }
  if (Array.isArray(notes)) {
    return notes
      .map((n) => {
        if (typeof n === 'string') return n;
        if (n && typeof n === 'object' && 'note' in n && typeof (n as { note: unknown }).note === 'string') {
          return (n as { note: string }).note;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n')
      .replace(/<[^>]*>?/gm, '')
      .trim();
  }
  return undefined;
}

/** Show the "Update Available" dialog with an option to download and install. */
export async function promptUpdateAvailable(version: string, releaseNotes?: string): Promise<boolean> {
  if (isPromptShowing) return false;
  isPromptShowing = true;
  try {
    const win = getWindowForDialog();
    if (!win) activateAppForDialog();

    let detail = `A new version of POS Hardware Bridge (v${version}) is available. You are running v${app.getVersion()}.`;
    if (releaseNotes) {
      const trimmedNotes = releaseNotes.trim();
      const snippet = trimmedNotes.length > 300 ? trimmedNotes.slice(0, 300) + '…' : trimmedNotes;
      detail += `\n\nRelease notes:\n${snippet}`;
    }
    detail += `\n\nWould you like to download and install this update now?`;

    const { response } = await dialog.showMessageBox(win ?? (undefined as unknown as BrowserWindow), {
      type: 'info',
      title: 'Update Available',
      message: `POS Hardware Bridge v${version} is available!`,
      detail,
      buttons: ['Update Now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });

    if (response === 0) {
      void startDownloadUpdate();
      return true;
    } else {
      dismissedVersion = version;
      return false;
    }
  } finally {
    isPromptShowing = false;
  }
}

/** Show the "Update Ready" dialog prompting to restart and apply the update. */
export async function promptUpdateReady(version: string): Promise<boolean> {
  if (isPromptShowing) return false;
  isPromptShowing = true;
  try {
    const win = getWindowForDialog();
    if (!win) activateAppForDialog();

    const { response } = await dialog.showMessageBox(win ?? (undefined as unknown as BrowserWindow), {
      type: 'info',
      title: 'Update Ready to Install',
      message: `Update v${version} downloaded successfully!`,
      detail: `POS Hardware Bridge v${version} has been downloaded.\n\nRestart the application now to finish updating?`,
      buttons: ['Restart & Install', 'Later'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });

    if (response === 0) {
      installUpdateNow();
      return true;
    }
    return false;
  } finally {
    isPromptShowing = false;
  }
}

/** Dialog shown when a manual check finds the app is already up to date. */
export async function promptUpToDate(): Promise<void> {
  const win = getWindowForDialog();
  if (!win) activateAppForDialog();

  await dialog.showMessageBox(win ?? (undefined as unknown as BrowserWindow), {
    type: 'info',
    title: 'Check for Updates',
    message: `You’re up to date!`,
    detail: `POS Hardware Bridge v${app.getVersion()} is currently the newest version available.`,
    buttons: ['OK'],
    defaultId: 0,
    noLink: true,
  });
}

/** Dialog shown when an update check fails during a manual check. */
export async function promptUpdateError(errorMessage: string): Promise<void> {
  const win = getWindowForDialog();
  if (!win) activateAppForDialog();

  await dialog.showMessageBox(win ?? (undefined as unknown as BrowserWindow), {
    type: 'warning',
    title: 'Update Check Failed',
    message: `Could not check for updates`,
    detail: errorMessage || `Please check your internet connection and try again later.`,
    buttons: ['OK'],
    defaultId: 0,
    noLink: true,
  });
}

/** Dialog shown when checking for updates in development mode. */
export async function promptDevMode(): Promise<void> {
  const win = getWindowForDialog();
  if (!win) activateAppForDialog();

  await dialog.showMessageBox(win ?? (undefined as unknown as BrowserWindow), {
    type: 'info',
    title: 'Check for Updates',
    message: `Development Mode`,
    detail: `POS Hardware Bridge v${app.getVersion()} is running in development mode.\n\nAutomatic updates are active in packaged releases.`,
    buttons: ['OK'],
    defaultId: 0,
    noLink: true,
  });
}

/** Start downloading the available update. */
export async function startDownloadUpdate(): Promise<void> {
  if (current.state !== 'available') return;
  const targetVer = current.version;
  set({ state: 'downloading', version: targetVer, percent: 0 });

  if (!app.isPackaged) {
    // In development mode, simulate progress for testing UI & flow
    log.info(`[updater] simulating update download for v${targetVer}`);
    let pct = 0;
    const interval = setInterval(() => {
      pct += 25;
      if (pct < 100) {
        set({ state: 'downloading', version: targetVer, percent: pct });
      } else {
        clearInterval(interval);
        set({ state: 'ready', version: targetVer });
        void promptUpdateReady(targetVer);
      }
    }, 600);
    return;
  }

  try {
    log.info(`[updater] downloading update v${targetVer}…`);
    await autoUpdater.downloadUpdate();
  } catch (err) {
    log.error('failed to download update', err);
    set({ state: 'error', message: err instanceof Error ? err.message : 'Failed to download update.' });
  }
}

/** Install the downloaded update now (restarts the bridge). */
export function installUpdateNow(): void {
  if (current.state === 'ready') {
    if (!app.isPackaged) {
      log.info('[updater] simulated installUpdateNow in dev mode');
      set({ state: 'up-to-date', version: current.version });
      return;
    }
    if (onBeforeInstall) onBeforeInstall();
    autoUpdater.quitAndInstall(false, true);
  }
}

/** Check for updates from GitHub Releases. */
export async function checkForUpdates(manual = false): Promise<UpdateState> {
  isManualCheck = manual;
  if (!app.isPackaged) {
    set({ state: 'up-to-date', version: app.getVersion() });
    if (manual) {
      await promptDevMode();
    }
    return current;
  }

  set({ state: 'checking' });
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    log.warn('update check failed', err);
    const msg = err instanceof Error ? err.message : String(err);
    set({ state: 'error', message: 'Could not check for updates. Will try again later.' });
    if (manual) {
      isManualCheck = false;
      await promptUpdateError(msg);
    }
  }
  return current;
}

/** Simulate an available update for UI testing. */
export function simulateUpdate(targetVersion = '1.1.0'): void {
  const notes = '- Added auto-update mechanism with interactive popup\n- Faster receipt printing\n- Minor bug fixes';
  set({
    state: 'available',
    version: targetVersion,
    releaseNotes: notes,
  });
  void promptUpdateAvailable(targetVersion, notes);
}

/** Initialize automatic update listeners and schedule periodic checks. */
export function startAutoUpdates(): void {
  if (timer) return;
  autoUpdater.logger = {
    info: (m: unknown) => log.info('updater', m),
    warn: (m: unknown) => log.warn('updater', m),
    error: (m: unknown) => log.error('updater', m),
    debug: () => undefined,
  };
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    set({ state: 'checking' });
  });

  autoUpdater.on('update-not-available', (info) => {
    set({ state: 'up-to-date', version: info?.version ?? app.getVersion() });
    if (isManualCheck) {
      isManualCheck = false;
      void promptUpToDate();
    }
  });

  autoUpdater.on('update-available', (info) => {
    const wasManual = isManualCheck;
    isManualCheck = false;
    const notes = formatReleaseNotes(info.releaseNotes);

    set({
      state: 'available',
      version: info.version,
      releaseNotes: notes,
      releaseDate: info.releaseDate,
    });

    if (wasManual || dismissedVersion !== info.version) {
      void promptUpdateAvailable(info.version, notes);
    }
  });

  autoUpdater.on('download-progress', (p) => {
    if (current.state === 'downloading' || current.state === 'available') {
      const ver = 'version' in current ? current.version : '';
      set({
        state: 'downloading',
        version: ver,
        percent: Math.round(p.percent),
        bytesPerSecond: Math.round(p.bytesPerSecond),
      });
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    log.info(`update ${info.version} downloaded; ready to install`);
    set({ state: 'ready', version: info.version });
    void promptUpdateReady(info.version);
  });

  autoUpdater.on('error', (err) => {
    log.warn('updater error', err);
    const msg = err instanceof Error ? err.message : String(err);
    set({ state: 'error', message: 'Could not download the update. Will try again later.' });
    if (isManualCheck) {
      isManualCheck = false;
      void promptUpdateError(msg);
    }
  });

  if (!app.isPackaged) return;

  // First check 30 seconds after start, then every 6 hours.
  setTimeout(() => void checkForUpdates(false), 30_000).unref();
  timer = setInterval(() => void checkForUpdates(false), CHECK_EVERY_MS);
  timer.unref();
}
