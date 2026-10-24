import { app } from 'electron';
import { getConfig } from './config-store';
import { log } from './logger';

export const HIDDEN_ARG = '--hidden';

/** Register (or unregister) the bridge to start when the user signs in. Only the
 * installed app is registered: in development this would point at the bare
 * Electron binary instead of the bridge. */
export function applyLaunchAtLogin(): void {
  const enabled = getConfig().app.launchAtLogin;
  if (!app.isPackaged) {
    log.info(`launch at login = ${enabled} (not registered in development)`);
    return;
  }
  try {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      openAsHidden: true,
      args: [HIDDEN_ARG],
    });
    log.info(`launch at login = ${enabled}`);
  } catch (err) {
    log.error('could not change launch at login', err);
  }
}

/** True when the OS started us at sign-in, so we stay quietly in the tray. */
export function startedAtLogin(): boolean {
  if (process.argv.includes(HIDDEN_ARG)) return true;
  try {
    return app.getLoginItemSettings().wasOpenedAtLogin === true;
  } catch {
    return false;
  }
}
