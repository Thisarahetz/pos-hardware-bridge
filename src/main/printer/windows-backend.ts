import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { log } from '../logger';
import { queueNameFor, type PrinterBackend, type PrintQueue, type UsbPrinterDevice } from './backend';
import { WINDOWS_WORKER_SCRIPT } from './windows-worker.ps1';

interface WinQueue {
  name: string;
  port: string;
  driver: string;
  offline: boolean;
  paused: boolean;
  jobs: number;
  host: string | null;
  tcpPort: number | null;
}

interface WinUsbPort {
  port: string;
  label: string;
  connected: boolean;
}

interface WinState {
  queues: WinQueue[];
  usb: WinUsbPort[];
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout };

/** One long-lived hidden PowerShell process, so each print or status check
 * doesn't pay PowerShell's ~1s startup cost. Restarted automatically if it dies. */
class PowerShellWorker {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = '';
  private nextId = 1;
  private pending = new Map<number, Pending>();

  private start(): ChildProcessWithoutNullStreams {
    const encoded = Buffer.from(WINDOWS_WORKER_SCRIPT, 'utf16le').toString('base64');
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-NoLogo', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true },
    );
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.onData(chunk));
    child.stderr.on('data', (chunk) => log.warn('printer worker stderr', String(chunk).trim()));
    child.on('exit', (code) => {
      log.warn('printer worker exited', code);
      if (this.child === child) this.child = null;
      this.failAll(new Error('Printer service restarted, please try again.'));
    });
    child.on('error', (err) => log.error('printer worker failed to start', err));
    this.child = child;
    return child;
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let newline = this.buffer.indexOf('\n');
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).replace(/^﻿/, '').trim();
      this.buffer = this.buffer.slice(newline + 1);
      newline = this.buffer.indexOf('\n');
      if (!line.startsWith('{')) continue;
      try {
        const msg = JSON.parse(line) as { id: number; ok: boolean; value?: unknown; error?: string };
        const p = this.pending.get(msg.id);
        if (!p) continue;
        clearTimeout(p.timer);
        this.pending.delete(msg.id);
        if (msg.ok) p.resolve(msg.value);
        else p.reject(new Error(msg.error ?? 'Printer command failed'));
      } catch (err) {
        log.warn('printer worker sent bad output', line.slice(0, 200));
      }
    }
  }

  private failAll(err: Error): void {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }

  request<T>(cmd: string, args: Record<string, unknown> = {}, timeoutMs = 20000): Promise<T> {
    const child = this.child ?? this.start();
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('The Windows print system did not respond.'));
        // A stuck worker would block every later request; start fresh next time.
        child.kill();
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      child.stdin.write(`${JSON.stringify({ id, cmd, ...args })}\n`);
    });
  }

  stop(): void {
    this.child?.kill();
    this.child = null;
  }
}

const worker = new PowerShellWorker();

/** Virtual printers that can never be a receipt printer. */
const VIRTUAL = /^(PORTPROMPT:|nul:|SHRFAX:|FILE:)|XPS|PDF|OneNote|Fax/i;

// Status checks call listQueues and listUsbDevices back to back; share one query.
let cached: { at: number; state: Promise<WinState> } | null = null;
function getState(): Promise<WinState> {
  if (cached && Date.now() - cached.at < 1500) return cached.state;
  const state = worker.request<WinState>('state').then((s) => ({
    queues: s?.queues ?? [],
    usb: s?.usb ?? [],
  }));
  cached = { at: Date.now(), state };
  state.catch(() => {
    cached = null;
  });
  return state;
}

function invalidate(): void {
  cached = null;
}

async function listQueues(): Promise<PrintQueue[]> {
  const { queues, usb } = await getState();
  const usbLabels = new Map(usb.map((u) => [u.port, u.label]));
  return queues
    .filter((q) => !VIRTUAL.test(`${q.port} ${q.name} ${q.driver}`))
    .map((q) => {
      const isUsb = /^USB\d+$/i.test(q.port);
      return {
        name: q.name,
        label: (isUsb && usbLabels.get(q.port)) || q.name,
        connection: isUsb ? 'usb' : q.host ? 'network' : 'other',
        usbDeviceId: isUsb ? q.port : undefined,
        host: q.host ?? undefined,
        port: q.tcpPort ?? undefined,
        enabled: !q.offline && !q.paused,
      } satisfies PrintQueue;
    });
}

async function listUsbDevices(): Promise<UsbPrinterDevice[]> {
  const { usb } = await getState();
  return usb.filter((u) => u.connected).map((u) => ({ id: u.port, label: u.label || `USB printer (${u.port})` }));
}

async function pendingJobs(queueName: string): Promise<number> {
  const { queues } = await getState();
  return queues.find((q) => q.name === queueName)?.jobs ?? 0;
}

async function installUsb(device: UsbPrinterDevice): Promise<string> {
  if (!/^USB\d+$/i.test(device.id)) throw new Error('Not a USB printer port.');
  const name = queueNameFor(device.label);
  // Waits for the Windows permission prompt, so allow plenty of time.
  await worker.request('install', { port: device.id, name }, 180000);
  invalidate();
  return name;
}

export const windowsBackend: PrinterBackend = {
  listQueues,
  listUsbDevices,
  pendingJobs,
  installUsb,
  resume: async (name) => {
    await worker.request('resume', { name });
    invalidate();
  },
  clear: async (name) => {
    await worker.request('clear', { name });
    invalidate();
  },
  sendRaw: async (name, data, docName) => {
    await worker.request('print', { printer: name, data: data.toString('base64'), doc: docName }, 30000);
    invalidate();
  },
};

export function stopWindowsWorker(): void {
  worker.stop();
}
