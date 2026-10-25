import { app } from 'electron';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import { getConfig } from '../config-store';
import { log } from '../logger';
import { printHtmlPage, printTestPage } from '../printer/printer.service';
import { printReceiptLine } from '../printer/receiptline.service';
import { getStatus, statusEvents } from '../status-monitor';
import {
  clearCloudLink,
  getCloudLink,
  getCloudToken,
  lastServerUrl,
  rememberPrinted,
  saveCloudLink,
  updateCloudNames,
  wasPrinted,
} from './cloud-store';

/**
 * The bridge as a "print station" for an online POS: any POS device in the shop can
 * print here. The bridge makes every connection itself (a long-poll that the
 * backend answers as soon as a print is queued), so the printer computer
 * needs no open ports, fixed IP or router setup, and works on any network.
 */

export type CloudStateName = 'off' | 'connecting' | 'connected' | 'offline' | 'removed';

export interface CloudState {
  state: CloudStateName;
  /** One plain sentence for the settings window and tray. */
  message: string;
  serverUrl: string;
  shopName?: string;
  stationName?: string;
  lastJob?: { title: string; at: string; ok: boolean; error?: string };
}

interface StationJob {
  id: string;
  kind: string;
  printer: string | null;
  html: string | null;
  /** A ReceiptLine document: printed with the printer's own fonts. */
  receiptline?: string | null;
  format: string | null;
  title: string | null;
  copies: number;
}

const LONG_POLL_SECONDS = 25;
const HEARTBEAT_MS = 30_000;
const MAX_BACKOFF_MS = 30_000;

export const cloudEvents = new EventEmitter();

let state: CloudState = { state: 'off', message: 'Not connected.', serverUrl: '' };
let running = false;
let pollAbort: AbortController | null = null;
let wake: (() => void) | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;
let heartbeatDebounce: NodeJS.Timeout | null = null;
/** Results not yet delivered (network dropped right after printing). */
const pendingResults = new Map<string, { status: 'printed' | 'failed'; error?: string }>();

class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function setState(next: Partial<CloudState>): void {
  state = { ...state, ...next };
  cloudEvents.emit('state', state);
}

export function getCloudState(): CloudState {
  return state;
}

/**
 * Accept "api.shop.com", "https://api.shop.com" or a full base such as
 * "https://pos.example.com/api/v1" or "https://pos.example.com/printing";
 * return the API base the /print-station/... routes hang off. A bare host gets
 * "/api/v1"; a POS with another path types the full address.
 */
export function normalizeServerUrl(input: string): string {
  let text = input.trim().replace(/\/+$/, '');
  if (!text) throw new Error('Type your POS website address.');
  const isLocal = (host: string) => /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
  // No scheme typed: a server on this computer or the shop network is plain
  // http; anything on the internet must be https.
  if (!/^https?:\/\//i.test(text)) text = `${isLocal(text.split(/[/:]/)[0]) ? 'http' : 'https'}://${text}`;
  const url = new URL(text);
  const local = isLocal(url.hostname);
  if (url.protocol !== 'https:' && !local) {
    throw new Error('Use an https:// address, so the connection to your POS is encrypted.');
  }
  if (url.pathname === '' || url.pathname === '/') url.pathname = '/api/v1';
  return url.toString().replace(/\/+$/, '');
}

async function api<T>(
  method: string,
  path: string,
  body?: unknown,
  opts: { serverUrl?: string; token?: string | null; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<T> {
  const serverUrl = opts.serverUrl ?? getCloudLink()?.serverUrl;
  if (!serverUrl) throw new ApiError(0, 'NOT_LINKED', 'Not connected.');
  const token = opts.token === undefined ? getCloudToken() : opts.token;
  const signals = [AbortSignal.timeout(opts.timeoutMs ?? 15_000), ...(opts.signal ? [opts.signal] : [])];
  let res: Response;
  try {
    res = await fetch(`${serverUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Station ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.any(signals),
    });
  } catch (err) {
    const aborted = err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError');
    throw new ApiError(0, aborted ? 'ABORTED' : 'NETWORK', aborted ? 'Request stopped.' : `Can't reach your POS at ${new URL(serverUrl).host}. Check the internet connection.`);
  }
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON (a proxy's error page): fall through to the status code.
  }
  if (!res.ok) {
    const e = json?.error ?? {};
    const message = typeof e.message === 'string' ? e.message : Array.isArray(e.message) ? e.message.join('; ') : `Your POS answered ${res.status}.`;
    throw new ApiError(res.status, e.code ?? `HTTP_${res.status}`, message);
  }
  return json as T;
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      wake = null;
      resolve();
    }
    wake = done;
  });

// ── printing a job ───────────────────────────────────────────────────

async function printJob(job: StationJob): Promise<void> {
  if (job.kind === 'test') {
    await printTestPage(job.printer ?? undefined);
    return;
  }
  if (job.receiptline) {
    await printReceiptLine(job.receiptline, job.printer ?? undefined, { copies: job.copies, title: job.title });
    return;
  }
  if (!job.html) throw new Error('The print job had no page to print.');
  await printHtmlPage(job.html, job.printer ?? undefined, { format: job.format, copies: job.copies, title: job.title });
}

async function handleJob(job: StationJob): Promise<void> {
  const title = job.title?.trim() || (job.kind === 'test' ? 'Test page' : 'Bill');
  // Delivered again after a dropped connection: report it, never print twice.
  if (wasPrinted(job.id)) {
    pendingResults.set(job.id, { status: 'printed' });
  } else {
    try {
      await printJob(job);
      rememberPrinted(job.id);
      pendingResults.set(job.id, { status: 'printed' });
      setState({ lastJob: { title, at: new Date().toISOString(), ok: true } });
      log.info(`cloud job ${job.id} printed (${title})`);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      pendingResults.set(job.id, { status: 'failed', error: error.slice(0, 480) });
      setState({ lastJob: { title, at: new Date().toISOString(), ok: false, error } });
      log.warn(`cloud job ${job.id} failed: ${error}`);
    }
  }
  await flushResults();
}

async function flushResults(): Promise<void> {
  for (const [id, result] of [...pendingResults]) {
    try {
      await api('POST', `/print-station/jobs/${id}/result`, result);
      pendingResults.delete(id);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 400)) {
        pendingResults.delete(id); // the job is gone or already final
      } else {
        throw err;
      }
    }
  }
}

// ── heartbeat ────────────────────────────────────────────────────────

function printerReport() {
  const status = getStatus();
  const printers = getConfig().printers;
  return printers.map((p, index) => {
    const s = status?.printers.find((x) => x.id === p.id);
    return {
      id: p.id,
      name: p.name.slice(0, 80),
      kind: p.kind,
      paper: p.kind === 'document' ? p.paperSize : p.paperWidthChars <= 32 ? '58mm' : '80mm',
      level: s?.level ?? 'off',
      title: (s?.title ?? 'Checking…').slice(0, 120),
      detail: s?.detail ? s.detail.slice(0, 240) : undefined,
      isDefault: printers.findIndex((x) => x.kind === p.kind) === index,
    };
  });
}

async function sendHeartbeat(): Promise<void> {
  if (!getCloudLink()) return;
  try {
    const res = await api<{ stationName: string; shopName: string }>('PUT', '/print-station/status', {
      printers: printerReport(),
      bridgeVersion: app.getVersion(),
    });
    updateCloudNames({ stationName: res.stationName, shopName: res.shopName });
    if (state.state !== 'connected' && running) {
      setState({
        state: 'connected',
        message: `Printing for every device in ${res.shopName}.`,
        shopName: res.shopName,
        stationName: res.stationName,
      });
    } else if (state.shopName !== res.shopName || state.stationName !== res.stationName) {
      setState({ shopName: res.shopName, stationName: res.stationName });
    }
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) handleRemoved();
    // Otherwise the long-poll loop reports the connection problem.
  }
}

function scheduleHeartbeat(): void {
  if (heartbeatDebounce) clearTimeout(heartbeatDebounce);
  heartbeatDebounce = setTimeout(() => void sendHeartbeat(), 1500);
}

// ── the long-poll loop ───────────────────────────────────────────────

function handleRemoved(): void {
  const shop = state.shopName ?? getCloudLink()?.shopName ?? 'the shop';
  stopLoop();
  clearCloudLink();
  setState({
    state: 'removed',
    message: `This computer was removed from ${shop} in your POS. Get a new code in your POS and connect again to keep printing.`,
    shopName: undefined,
    stationName: undefined,
  });
  cloudEvents.emit('removed', shop);
}

async function loop(): Promise<void> {
  let backoff = 1000;
  while (running) {
    const link = getCloudLink();
    if (!link || !getCloudToken()) {
      running = false;
      setState({ state: 'off', message: 'Not connected.' });
      return;
    }
    try {
      await flushResults();
      pollAbort = new AbortController();
      const res = await api<{ jobs: StationJob[] }>(
        'POST',
        '/print-station/jobs/next',
        { waitSeconds: LONG_POLL_SECONDS },
        { timeoutMs: (LONG_POLL_SECONDS + 15) * 1000, signal: pollAbort.signal },
      );
      backoff = 1000;
      if (state.state !== 'connected') {
        setState({ state: 'connected', message: `Printing for every device in ${link.shopName}.` });
      }
      for (const job of res.jobs ?? []) await handleJob(job);
    } catch (err) {
      if (!running) return;
      if (err instanceof ApiError && err.status === 401) {
        handleRemoved();
        return;
      }
      if (err instanceof ApiError && err.code === 'ABORTED') continue; // kicked: poll again now
      const message = err instanceof Error ? err.message : String(err);
      setState({ state: 'offline', message: `${message} Retrying…` });
      log.warn(`cloud poll failed: ${message}`);
      await sleep(backoff);
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
    }
  }
}

function stopLoop(): void {
  running = false;
  pollAbort?.abort();
  wake?.();
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

/** Start printing for the online POS if this computer is paired. Safe to call again. */
export function startCloud(): void {
  const link = getCloudLink();
  state = { ...state, serverUrl: link?.serverUrl ?? lastServerUrl() };
  if (!link) {
    setState({ state: state.state === 'removed' ? 'removed' : 'off', message: state.state === 'removed' ? state.message : 'Not connected.' });
    return;
  }
  if (running) return;
  running = true;
  setState({ state: 'connecting', message: `Connecting to ${link.shopName}…`, shopName: link.shopName, stationName: link.stationName, serverUrl: link.serverUrl });
  heartbeatTimer = setInterval(() => void sendHeartbeat(), HEARTBEAT_MS);
  // Report the printers right away; the long-poll may sit quietly for 25 s.
  void sendHeartbeat();
  void loop();
}

/** After sleep or a network change: drop the stale connection and poll now. */
export function kickCloud(): void {
  if (!running) return;
  pollAbort?.abort();
  wake?.();
}

export async function pairStation(serverInput: string, code: string, name: string): Promise<CloudState> {
  const serverUrl = normalizeServerUrl(serverInput);
  const cleanCode = code.replace(/\D/g, '');
  if (cleanCode.length !== 6) throw new Error('Type the 6-digit code from your POS.');
  const stationName = name.trim() || os.hostname();
  const res = await api<{ stationId: string; token: string; stationName: string; shopName: string }>(
    'POST',
    '/print-station/pair',
    { code: cleanCode, name: stationName.slice(0, 60), bridgeVersion: app.getVersion() },
    { serverUrl, token: null },
  );
  stopLoop();
  saveCloudLink({ serverUrl, stationId: res.stationId, stationName: res.stationName, shopName: res.shopName }, res.token);
  log.info(`paired with online POS as "${res.stationName}" for ${res.shopName}`);
  state = { state: 'off', message: '', serverUrl };
  startCloud();
  return state;
}

/** Unpair: the backend revokes the token, and this computer stops printing. */
export async function disconnectStation(): Promise<CloudState> {
  const link = getCloudLink();
  stopLoop();
  if (link) {
    await api('DELETE', '/print-station/me').catch((err) => log.warn(`disconnect call failed: ${err.message}`));
  }
  clearCloudLink();
  setState({ state: 'off', message: 'Not connected.', shopName: undefined, stationName: undefined, lastJob: undefined, serverUrl: link?.serverUrl ?? state.serverUrl });
  return state;
}

// Keep the shop's printer list in the POS up to date as printers come and go.
statusEvents.on('change', () => {
  if (running) scheduleHeartbeat();
});
