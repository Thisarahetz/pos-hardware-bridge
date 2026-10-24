import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { queueNameFor, type PrinterBackend, type PrintQueue, type UsbPrinterDevice } from './backend';

const run = promisify(execFile);

async function sh(cmd: string, args: string[], timeout = 5000): Promise<string> {
  try {
    const { stdout } = await run(cmd, args, { timeout, encoding: 'utf8' });
    return stdout;
  } catch (err) {
    // lpstat exits non-zero when there are no printers at all; treat as empty.
    const stdout = (err as { stdout?: string }).stdout;
    return typeof stdout === 'string' ? stdout : '';
  }
}

export function labelFromUri(uri: string): string {
  const match = /^[a-z]+:\/\/([^/?]+)\/?([^?]*)/i.exec(uri);
  if (!match) return uri;
  const parts = [match[1], match[2]].map((p) => decodeURIComponent(p.replace(/\+/g, ' '))).filter(Boolean);
  return parts.join(' ').trim() || uri;
}

async function listQueues(): Promise<PrintQueue[]> {
  const [devices, states] = await Promise.all([sh('lpstat', ['-v']), sh('lpstat', ['-p'])]);
  const enabled = new Map<string, boolean>();
  for (const line of states.split('\n')) {
    const m = /^printer (\S+) (.*)$/.exec(line);
    if (m) enabled.set(m[1], !/disabled/i.test(m[2]));
  }
  const queues: PrintQueue[] = [];
  for (const line of devices.split('\n')) {
    const m = /^device for ([^:]+):\s*(\S+)/.exec(line);
    if (!m) continue;
    const [, name, uri] = m;
    const socket = /^socket:\/\/([^:/]+)(?::(\d+))?/i.exec(uri);
    const isUsb = uri.startsWith('usb://');
    queues.push({
      name,
      label: isUsb ? labelFromUri(uri) : name.replace(/_/g, ' '),
      connection: isUsb ? 'usb' : socket ? 'network' : 'other',
      usbDeviceId: isUsb ? uri : undefined,
      host: socket?.[1],
      port: socket ? Number(socket[2] ?? 9100) : undefined,
      enabled: enabled.get(name) ?? true,
    });
  }
  return queues;
}

async function listUsbDevices(): Promise<UsbPrinterDevice[]> {
  const out = await sh('lpinfo', ['--include-schemes', 'usb', '-v'], 8000);
  return out
    .split('\n')
    .map((line) => /^\S+\s+(usb:\/\/\S+)/.exec(line)?.[1])
    .filter((uri): uri is string => Boolean(uri))
    .map((uri) => ({ id: uri, label: labelFromUri(uri) }));
}

async function pendingJobs(queueName: string): Promise<number> {
  const out = await sh('lpstat', ['-o', queueName]);
  return out.split('\n').filter((l) => l.trim()).length;
}

async function installUsb(device: UsbPrinterDevice): Promise<string> {
  const name = queueNameFor(device.label);
  const base = ['-p', name, '-E', '-v', device.id];
  try {
    // Linux still accepts raw queues; macOS refuses them, so fall back to a
    // driverless queue (`lp -o raw` jobs pass through unchanged either way).
    await run('lpadmin', [...base, '-m', 'raw'], { timeout: 10000 });
  } catch {
    try {
      await run('lpadmin', base, { timeout: 10000 });
    } catch (err) {
      const msg = (err as { stderr?: string }).stderr?.trim() || (err as Error).message;
      throw new Error(`Could not add the printer to the system: ${msg}`);
    }
  }
  await sh('cupsenable', [name]);
  await sh('cupsaccept', [name]);
  return name;
}

function sendRaw(queueName: string, data: Buffer, docName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile('lp', ['-d', queueName, '-o', 'raw', '-t', docName], { timeout: 15000 }, (err, _stdout, stderr) => {
      if (err) reject(new Error(String(stderr || err.message).trim()));
      else resolve();
    });
    child.stdin?.end(data);
  });
}

export const cupsBackend: PrinterBackend = {
  listQueues,
  listUsbDevices,
  pendingJobs,
  installUsb,
  resume: async (name) => {
    await sh('cupsenable', [name]);
    await sh('cupsaccept', [name]);
  },
  clear: async (name) => {
    await sh('cancel', ['-a', name]);
  },
  sendRaw,
};
