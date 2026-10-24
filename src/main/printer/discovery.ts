import { Socket } from 'node:net';
import os from 'node:os';
import { getBackend } from './backend';

export type DiscoveredKind = 'usb' | 'network' | 'system';

export interface DiscoveredPrinter {
  /** Stable key for the UI: `queue:<name>`, `usb:<device id>` or `net:<host>:<port>`. */
  id: string;
  kind: DiscoveredKind;
  label: string;
  /** Name of the OS print queue, when the printer is already installed. */
  queueName?: string;
  /** USB device id (CUPS usb:// URI or Windows port such as USB001). */
  usbDeviceId?: string;
  host?: string;
  port?: number;
  installed: boolean;
  online: boolean;
  likelyReceiptPrinter: boolean;
}

const RECEIPT_HINTS =
  /pos|receipt|thermal|portable|tm-|tsp\d|xprinter|rongta|bixolon|citizen|sewoo|hprt|gprinter|zjiang|munbyn|epson|star micronics|58mm|80mm|generic \/ text/i;

export function probeTcp(host: string, port: number, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket();
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, host);
  });
}

export async function discoverPrinters(): Promise<DiscoveredPrinter[]> {
  const backend = getBackend();
  const [queues, usb] = await Promise.all([backend.listQueues(), backend.listUsbDevices()]);
  const connectedUsb = new Set(usb.map((d) => d.id));
  const queuedUsb = new Set(queues.map((q) => q.usbDeviceId).filter(Boolean));
  const result: DiscoveredPrinter[] = [];

  for (const q of queues) {
    let online = true;
    if (q.connection === 'usb') online = connectedUsb.has(q.usbDeviceId ?? '');
    else if (q.connection === 'network' && q.host) online = await probeTcp(q.host, q.port ?? 9100, 800);
    result.push({
      id: `queue:${q.name}`,
      kind: q.connection === 'other' ? 'system' : q.connection,
      label: q.label,
      queueName: q.name,
      usbDeviceId: q.usbDeviceId,
      host: q.host,
      port: q.port,
      installed: true,
      online,
      likelyReceiptPrinter: RECEIPT_HINTS.test(`${q.name} ${q.label} ${q.usbDeviceId ?? ''}`),
    });
  }

  for (const d of usb) {
    if (queuedUsb.has(d.id)) continue;
    result.push({
      id: `usb:${d.id}`,
      kind: 'usb',
      label: d.label,
      usbDeviceId: d.id,
      installed: false,
      online: true,
      likelyReceiptPrinter: RECEIPT_HINTS.test(`${d.label} ${d.id}`),
    });
  }

  // Plugged-in receipt printers first, then everything else.
  const rank = (p: DiscoveredPrinter) => (p.online ? 0 : 2) + (p.likelyReceiptPrinter ? 0 : 1);
  return result.sort((a, b) => rank(a) - rank(b));
}

/** Find raw-socket (port 9100) printers on the local /24 networks. */
export async function scanNetworkPrinters(port = 9100): Promise<DiscoveredPrinter[]> {
  const prefixes = new Set<string>();
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) prefixes.add(a.address.split('.').slice(0, 3).join('.'));
    }
  }
  const hosts: string[] = [];
  for (const prefix of prefixes) for (let i = 1; i < 255; i++) hosts.push(`${prefix}.${i}`);

  const found: string[] = [];
  const queue = [...hosts];
  const worker = async () => {
    for (let host = queue.shift(); host; host = queue.shift()) {
      if (await probeTcp(host, port, 400)) found.push(host);
    }
  };
  await Promise.all(Array.from({ length: 64 }, worker));

  return found.sort().map((host) => ({
    id: `net:${host}:${port}`,
    kind: 'network' as const,
    label: `Network printer at ${host}`,
    host,
    port,
    installed: false,
    online: true,
    likelyReceiptPrinter: true,
  }));
}
