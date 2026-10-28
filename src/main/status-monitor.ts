import { EventEmitter } from 'node:events';
import { getConfig } from './config-store';
import { getBackend } from './printer/backend';
import { probeTcp } from './printer/discovery';
import { log } from './logger';
import { serverState } from './server';
import { autoSetupPrinter } from './printer/setup';
import { listSerialPorts } from './terminal/terminal.service';
import type { BridgeStatus, DeviceStatus, PrinterProfile, PrinterStatus } from './types';

const POLL_MS = 4000;

export const statusEvents = new EventEmitter();

let current: BridgeStatus | null = null;
let timer: NodeJS.Timeout | null = null;
let checking: Promise<BridgeStatus> | null = null;

const NO_PRINTER: DeviceStatus = {
  level: 'off',
  title: 'No printer set up',
  detail: 'Receipts will not print until a printer is added.',
  steps: [
    'Plug the receipt printer into this computer with USB and turn it on. It is set up automatically.',
    'For an A4 printer or a second printer, pick it under “Add a printer”.',
    'For a network receipt printer, connect it to the same Wi-Fi/LAN and click “Scan network”.',
  ],
  action: 'setup-printer',
};

type DeviceSnapshot = Awaited<ReturnType<typeof loadDevices>>;

async function loadDevices() {
  const backend = getBackend();
  const [queues, usb] = await Promise.all([backend.listQueues(), backend.listUsbDevices()]);
  return { backend, queues, usb };
}

async function printerStatus(profile: PrinterProfile, devices: DeviceSnapshot): Promise<DeviceStatus> {
  const { connection } = profile;

  if (connection.type === 'tcp') {
    const { host, port } = connection;
    const reachable = await probeTcp(host, port);
    return reachable
      ? { level: 'ok', title: 'Ready', detail: `Network printer at ${host}:${port}`, steps: [] }
      : {
          level: 'error',
          title: 'Can’t reach the network printer',
          detail: `Nothing answered at ${host}:${port}.`,
          steps: [
            'Check the printer is turned on and its network light is on.',
            'Make sure this computer and the printer are on the same network.',
            'Print the printer’s self-test page (hold FEED while powering on) to confirm its IP address.',
          ],
        };
  }

  const { backend, queues, usb } = devices;
  const name = connection.queueName;
  const queue = queues.find((q) => q.name === name);
  if (!queue) {
    return {
      level: 'error',
      title: 'Printer was removed from the system',
      detail: `“${name}” no longer exists in the computer’s printer list.`,
      steps: ['Plug the printer in, then remove this printer here and add it again.'],
    };
  }

  if (!queue.enabled) {
    return {
      level: 'warning',
      title: 'Printing is paused or offline',
      detail: 'The computer paused this printer or marked it offline in Windows.',
      steps: [
        'Click “Resume printing” below to take it online.',
        'In Windows Settings > Printers, right-click the printer and ensure “Use Printer Offline” is unchecked.',
        'Make sure the printer is turned on, has paper, and has no error light blinking.',
      ],
      action: 'resume-queue',
    };
  }

  if (
    profile.kind === 'receipt' &&
    queue.connection === 'usb' &&
    usb.length > 0 &&
    queue.usbDeviceId &&
    !usb.some((d) => d.id === queue.usbDeviceId)
  ) {
    return {
      level: 'error',
      title: 'Printer disconnected',
      detail: `${queue.label} is unplugged or turned off.`,
      steps: [
        'Check the USB cable at both ends.',
        'Turn the printer on and wait for the light to stop blinking.',
        'Close the paper cover and make sure it has paper.',
      ],
    };
  }

  const waiting = await backend.pendingJobs(name);
  if (waiting >= 3) {
    return {
      level: 'warning',
      title: `${waiting} jobs waiting`,
      detail: 'Jobs are queuing up instead of printing.',
      steps: [
        'Check the printer has paper and no error light.',
        'Turn the printer off and on again.',
        'If old jobs should not print, click “Clear waiting jobs”.',
      ],
      action: 'clear-queue',
    };
  }

  const via = queue.connection === 'usb' ? 'USB' : queue.connection === 'network' ? 'network' : 'installed printer';
  return { level: 'ok', title: 'Ready', detail: `${queue.label} (${via})`, steps: [] };
}

async function allPrinterStatuses(): Promise<PrinterStatus[]> {
  const { printers } = getConfig();
  if (printers.length === 0) return [];
  const needsDevices = printers.some((p) => p.connection.type === 'system');
  const devices = needsDevices ? await loadDevices() : ({ backend: getBackend(), queues: [], usb: [] } as DeviceSnapshot);
  return Promise.all(
    printers.map(async (p) => {
      const status = await printerStatus(p, devices).catch((err) => checkFailed(`printer “${p.name}”`, err));
      return { ...status, id: p.id, name: p.name, kind: p.kind };
    }),
  );
}

/** One-line summary of the default receipt printer, for the tray and older POS integrations. */
function summary(printers: PrinterStatus[]): DeviceStatus {
  const main = printers.find((p) => p.kind === 'receipt') ?? printers[0];
  if (!main) return NO_PRINTER;
  const { id: _id, name, kind: _kind, ...status } = main;
  return { ...status, title: status.level === 'ok' ? 'Printer ready' : status.title, detail: `${name}: ${status.detail}` };
}

async function terminalStatus(): Promise<DeviceStatus> {
  const config = getConfig().terminal;
  if (!config.enabled) {
    return { level: 'off', title: 'Card terminal off', detail: 'Not used.', steps: [] };
  }
  if (!config.serialPath) {
    return {
      level: 'error',
      title: 'No terminal port selected',
      detail: 'Choose the port the card terminal is plugged into.',
      steps: ['Plug in the terminal and pick its port below.'],
    };
  }
  const ports = await listSerialPorts({ includeSystemPorts: true }).catch(() => []);
  if (!ports.some((p) => p.path === config.serialPath)) {
    return {
      level: 'error',
      title: 'Card terminal disconnected',
      detail: `${config.serialPath} is not available.`,
      steps: ['Check the terminal’s cable and power.', 'If it shows up under a new port, pick that port below.'],
    };
  }
  return { level: 'ok', title: 'Card terminal connected', detail: config.serialPath, steps: [] };
}

function checkFailed(device: string, err: unknown): DeviceStatus {
  log.warn(`status check for ${device} failed`, err);
  return {
    level: 'warning',
    title: `Can’t check the ${device} right now`,
    detail: err instanceof Error ? err.message : String(err),
    steps: ['This usually fixes itself within a few seconds.'],
  };
}

async function check(): Promise<BridgeStatus> {
  try {
    const picked = await autoSetupPrinter();
    if (picked) statusEvents.emit('auto-setup', picked);
  } catch (err) {
    log.warn('auto setup failed', err);
    statusEvents.emit('auto-setup-failed', err instanceof Error ? err.message : String(err));
  }

  const [printers, terminal] = await Promise.all([
    allPrinterStatuses().catch((err) => [{ ...checkFailed('printers', err), id: '', name: 'Printers', kind: 'receipt' as const }]),
    terminalStatus().catch((err) => checkFailed('card terminal', err)),
  ]);
  const server = serverState();
  const next: BridgeStatus = {
    printers,
    printer: summary(printers),
    terminal,
    api: { url: `http://127.0.0.1:${getConfig().server.port}`, running: server.running, error: server.error },
    checkedAt: new Date().toISOString(),
  };
  const changed =
    !current ||
    JSON.stringify({ ...current, checkedAt: '' }) !== JSON.stringify({ ...next, checkedAt: '' });
  const previous = current;
  current = next;
  if (changed) statusEvents.emit('change', next, previous);
  return next;
}

/** Run a check now (deduplicated if one is already running). */
export function refreshStatus(): Promise<BridgeStatus> {
  checking ??= check().finally(() => {
    checking = null;
  });
  return checking;
}

export function getStatus(): BridgeStatus | null {
  return current;
}

export function startStatusMonitor(): void {
  if (timer) return;
  void refreshStatus();
  timer = setInterval(() => void refreshStatus(), POLL_MS);
}

export function stopStatusMonitor(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
