import { safeStorage } from 'electron';
import store from '../config-store';

/**
 * Where this computer's link to AI POS is kept. Separate from the rest of the
 * settings because it holds the station token, which must never reach the
 * settings window or the local API: the token lets whoever has it receive the
 * shop's bills.
 */
export interface CloudLink {
  /** The AI POS API base, e.g. https://api.example.com/api/v1 */
  serverUrl: string;
  stationId: string;
  stationName: string;
  shopName: string;
  /** The station token, encrypted with the OS keychain when available. */
  token: string;
  tokenEncrypted: boolean;
}

const KEY = 'cloud';
const PRINTED_KEY = 'cloudPrintedJobs';
/** Remember this many printed job ids, so a job delivered twice prints once. */
const PRINTED_MEMORY = 500;

type Stored = { [KEY]?: CloudLink; [PRINTED_KEY]?: string[]; cloudServerUrl?: string };
const raw = store as unknown as { get<K extends keyof Stored>(k: K): Stored[K]; set<K extends keyof Stored>(k: K, v: Stored[K]): void; delete(k: keyof Stored): void };

export function getCloudLink(): CloudLink | null {
  return raw.get(KEY) ?? null;
}

export function getCloudToken(): string | null {
  const link = getCloudLink();
  if (!link) return null;
  if (!link.tokenEncrypted) return Buffer.from(link.token, 'base64').toString('utf8');
  try {
    return safeStorage.decryptString(Buffer.from(link.token, 'base64'));
  } catch {
    // Keychain changed (e.g. copied to another machine): pairing must be redone.
    return null;
  }
}

export function saveCloudLink(link: Omit<CloudLink, 'token' | 'tokenEncrypted'>, token: string): void {
  const encrypted = safeStorage.isEncryptionAvailable();
  const stored = encrypted ? safeStorage.encryptString(token) : Buffer.from(token, 'utf8');
  raw.set(KEY, { ...link, token: stored.toString('base64'), tokenEncrypted: encrypted });
  raw.set('cloudServerUrl', link.serverUrl);
}

export function updateCloudNames(names: { stationName?: string; shopName?: string }): void {
  const link = getCloudLink();
  if (link) raw.set(KEY, { ...link, ...names });
}

export function clearCloudLink(): void {
  raw.delete(KEY);
  raw.delete(PRINTED_KEY);
}

/** The server address last used, to pre-fill the form after a disconnect. */
export function lastServerUrl(): string {
  return raw.get('cloudServerUrl') ?? '';
}

export function wasPrinted(jobId: string): boolean {
  return (raw.get(PRINTED_KEY) ?? []).includes(jobId);
}

export function rememberPrinted(jobId: string): void {
  const ids = (raw.get(PRINTED_KEY) ?? []).filter((id) => id !== jobId);
  ids.push(jobId);
  raw.set(PRINTED_KEY, ids.slice(-PRINTED_MEMORY));
}
