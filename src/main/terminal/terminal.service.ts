import { EventEmitter } from 'node:events';
import { SerialPort } from 'serialport';
import { getConfig } from '../config-store';
import type { TerminalChargeRequest, TerminalChargeResult } from '../types';
import { GenericSerialTerminalDriver } from './generic-serial-driver';
import type { TerminalDriver } from './terminal-driver';

export const terminalEvents = new EventEmitter();

let driver: TerminalDriver | null = null;
let driverPath: string | null = null;

function getDriver(): TerminalDriver {
  const config = getConfig().terminal;
  if (!config.enabled) {
    throw new Error('Payment terminal is disabled in settings');
  }
  if (!config.serialPath) {
    throw new Error('No serial port configured for the payment terminal');
  }
  if (!driver || driverPath !== config.serialPath) {
    driver?.dispose();
    driver = new GenericSerialTerminalDriver(config);
    driverPath = config.serialPath;
  }
  return driver;
}

export function resetTerminalConnection(): void {
  driver?.dispose();
  driver = null;
  driverPath = null;
}

export async function charge(request: TerminalChargeRequest): Promise<TerminalChargeResult> {
  terminalEvents.emit('status', { status: 'pending', reference: request.reference });
  const result = await getDriver().charge(request);
  terminalEvents.emit('status', result);
  return result;
}

export async function cancel(reference: string): Promise<void> {
  await getDriver().cancel(reference);
  terminalEvents.emit('status', { status: 'cancelled', reference });
}

export function terminalStatus(): { connected: boolean } {
  try {
    return { connected: getDriver().isConnected() };
  } catch {
    return { connected: false };
  }
}

export async function listSerialPorts(): Promise<Array<{ path: string; manufacturer?: string }>> {
  const ports = await SerialPort.list();
  return ports.map((p) => ({ path: p.path, manufacturer: p.manufacturer }));
}
