import { EventEmitter } from 'node:events';
import { getConfig } from './config-store';
import { getBackend } from './printer/backend';
import { probeTcp } from './printer/discovery';
import { log } from './logger';
import { serverState } from './server';
import { autoSetupPrinter } from './printer/setup';
import { listSerialPorts } from './terminal/terminal.service';
import type { BridgeStatus, DeviceStatus } from './types';

const POLL_MS = 4000;

export const statusEvents = new EventEmitter();

let current: BridgeStatus | null = null;
let timer: NodeJS.Timeout | null = null;
let checking: Promise<BridgeStatus> | null = null;

async function printerStatus(): Promise<DeviceStatus> {
  const config = getConfig().printer;

  if (!config.enabled) {
    return {
      level: 'off',
      title: 'No printer set up',
      detail: 'Receipts will not print until a printer is chosen.',
      steps: [
        'Plug the receipt printer into this computer with USB and turn it on. It is set up automatically.',
        'For a network printer, connect it to the same Wi-Fi/LAN and click “Scan network”.',
      ],
      action: 'setup-printer',
    };
  }

  if (config.connectionType === 'network') {
    const { host, port } = config.network;
    const reachable = await probeTcp(host, port);
    return reachable
      ? { level: 'ok', title: 'Printer ready', detail: `Network printer at ${host}:${port}`, steps: [] }
      : {
          level: 'error',
          title: 'Can’t reach the network printer',
          detail: `Nothing answered at ${host}:${port}.`,
          steps: [
            'Check the printer is turned on and its network light is on.',
            'Make sure this computer and the printer are on the same network.',
            'Print the printer’s self-test page (hold FEED while powering on) to confirm its IP address.',
          ],
          action: 'setup-printer',
        };
  }

  const name = config.usb.systemPrinterName?.trim();
  if (!name) {
    return {
      level: 'error',
      title: 'No printer selected',
      detail: 'Choose a printer from the list below.',
      steps: ['Plug in the printer and pick it from “Printers found”.'],
      action: 'setup-printer',
    };
  }

  const backend = getBackend();
  const [queues, usb] = await Promise.all([backend.listQueues(), backend.listUsbDevices()]);
  const queue = queues.find((q) => q.name === name);
  if (!queue) {
    return {
      level: 'error',
      title: 'Printer was removed from the system',
      detail: `“${name}” no longer exists in the computer’s printer list.`,
      steps: ['Plug the printer in and pick it again from “Printers found”.'],
      action: 'setup-printer',
    };
  }

  const label = queue.label;
  if (queue.connection === 'usb' && !usb.some((d) => d.id === queue.usbDeviceId)) {
    return {
      level: 'error',
      title: 'Printer disconnected',
      detail: `${label} is unplugged or turned off.`,
      steps: [
        'Check the USB cable at both ends.',
        'Turn the printer on and wait for the light to stop blinking.',
        'Close the paper cover and make sure it has paper.',
      ],
    };
  }

  if (!queue.enabled) {
    return {
      level: 'warning',
      title: 'Printing is paused',
      detail: 'The computer paused this printer, usually after an error.',
      steps: ['Click “Resume printing”.'],
      action: 'resume-queue',
    };
  }

  const waiting = await backend.pendingJobs(name);
  if (waiting >= 3) {
    return {
      level: 'warning',
      title: `${waiting} receipts waiting`,
      detail: 'Jobs are queuing up instead of printing.',
      steps: [
        'Check the printer has paper and the cover is closed.',
        'Turn the printer off and on again.',
        'If old receipts should not print, click “Clear waiting jobs”.',
      ],
      action: 'clear-queue',
    };
  }

  const via = queue.connection === 'usb' ? 'USB' : queue.connection === 'network' ? 'network' : 'system printer';
  return { level: 'ok', title: 'Printer ready', detail: `${label} (${via})`, steps: [] };
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

  const [printer, terminal] = await Promise.all([
    printerStatus().catch((err) => checkFailed('printer', err)),
    terminalStatus().catch((err) => checkFailed('card terminal', err)),
  ]);
  const server = serverState();
  const next: BridgeStatus = {
    printer,
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
