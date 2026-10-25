import { EventEmitter } from 'node:events';
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import store, { getConfig } from '../config-store';

/**
 * Phones, tablets and other tills on the shop network. Each one pairs once
 * with a 6-digit code shown in the settings window and gets its own token,
 * so one device can be removed without touching the others. Device tokens can
 * print and read printer status, never take card payments.
 */

export interface PairedDevice {
  id: string;
  name: string;
  pairedAt: string;
  lastSeenAt?: string;
  lastAddress?: string;
}

interface StoredDevice extends PairedDevice {
  /** sha256 of the token: the token itself is shown to the device once. */
  tokenHash: string;
}

export interface PairingCode {
  code: string;
  expiresAt: string;
}

export interface LanState {
  enabled: boolean;
  port: number;
  /** Addresses other devices can use, e.g. http://192.168.1.20:9191 */
  addresses: string[];
  bridgeName: string;
  devices: PairedDevice[];
  pairing: PairingCode | null;
}

const DEVICES_KEY = 'lanDevices';
const BRIDGE_ID_KEY = 'bridgeId';
const PAIRING_TTL_MS = 10 * 60_000;
/** Wrong guesses allowed per code before it is thrown away. */
const MAX_WRONG_CODES = 5;
const MAX_DEVICES = 50;
/** Don't write lastSeenAt to disk on every request. */
const SEEN_WRITE_EVERY_MS = 60_000;

type Raw = { get(k: string): unknown; set(k: string, v: unknown): void };
const raw = store as unknown as Raw;

export const lanEvents = new EventEmitter();

let pairing: { code: string; expiresAt: number; wrong: number } | null = null;
let pairingTimer: NodeJS.Timeout | null = null;
const lastSeenWrite = new Map<string, number>();

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

function readDevices(): StoredDevice[] {
  const list = raw.get(DEVICES_KEY);
  return Array.isArray(list) ? (list as StoredDevice[]) : [];
}

function writeDevices(devices: StoredDevice[]): void {
  raw.set(DEVICES_KEY, devices);
}

const publicView = ({ tokenHash: _hash, ...device }: StoredDevice): PairedDevice => device;

/** A stable id for this bridge, so apps can tell two bridges on one network apart. */
export function bridgeId(): string {
  let id = raw.get(BRIDGE_ID_KEY);
  if (typeof id !== 'string' || !id) {
    id = randomUUID();
    raw.set(BRIDGE_ID_KEY, id);
  }
  return id as string;
}

let cachedName: string | null = null;

/** The computer's friendly name ("Front counter PC"), for device lists and discovery. */
export function bridgeName(): string {
  if (cachedName) return cachedName;
  let name = '';
  try {
    if (process.platform === 'darwin') name = execFileSync('scutil', ['--get', 'ComputerName'], { encoding: 'utf8', timeout: 2000 }).trim();
    else if (process.platform === 'win32') name = process.env.COMPUTERNAME ?? '';
  } catch {
    // fall back to the hostname
  }
  if (!name) name = os.hostname().replace(/\.local$/, '');
  // Some networks hand out the IP address as the hostname: not a name.
  if (!name || /^[\d.]+$/.test(name)) name = 'Printer computer';
  cachedName = name.slice(0, 60);
  return cachedName;
}

/** IPv4 addresses on the shop network (Wi-Fi / Ethernet), not loopback or VPN-internal. */
export function lanAddresses(): string[] {
  const port = getConfig().server.port;
  const found: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family !== 'IPv4' || net.internal) continue;
      if (net.address.startsWith('169.254.')) continue; // no DHCP: unusable
      found.push(`http://${net.address}:${port}`);
    }
  }
  return found;
}

export function getLanState(): LanState {
  const live = pairing && pairing.expiresAt > Date.now() ? pairing : null;
  return {
    enabled: getConfig().server.allowNetwork,
    port: getConfig().server.port,
    addresses: lanAddresses(),
    bridgeName: bridgeName(),
    devices: readDevices().map(publicView),
    pairing: live ? { code: live.code, expiresAt: new Date(live.expiresAt).toISOString() } : null,
  };
}

function changed(): void {
  lanEvents.emit('changed', getLanState());
}

/** Show a new 6-digit code in the settings window; valid for 10 minutes. */
export function startPairing(): PairingCode {
  if (!getConfig().server.allowNetwork) throw new Error('Turn on “Let phones and tablets print here” first.');
  if (readDevices().length >= MAX_DEVICES) throw new Error(`Up to ${MAX_DEVICES} devices can be paired. Remove one you no longer use.`);
  pairing = { code: String(randomInt(0, 1_000_000)).padStart(6, '0'), expiresAt: Date.now() + PAIRING_TTL_MS, wrong: 0 };
  if (pairingTimer) clearTimeout(pairingTimer);
  pairingTimer = setTimeout(cancelPairing, PAIRING_TTL_MS);
  changed();
  return { code: pairing.code, expiresAt: new Date(pairing.expiresAt).toISOString() };
}

export function cancelPairing(): void {
  pairing = null;
  if (pairingTimer) clearTimeout(pairingTimer);
  pairingTimer = null;
  changed();
}

export class PairingError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** A device swaps the code for its own token. The code works once. */
export function pairDevice(code: string, name: string, address?: string): { token: string; device: PairedDevice } {
  if (!getConfig().server.allowNetwork) throw new PairingError(403, 'This bridge does not accept devices from the network.');
  const live = pairing && pairing.expiresAt > Date.now() ? pairing : null;
  if (!live) throw new PairingError(400, 'No pairing code is active. On the printer computer, open the bridge and click “Get a code”.');
  const given = String(code ?? '').replace(/\D/g, '');
  const ok = given.length === 6 && timingSafeEqual(Buffer.from(given), Buffer.from(live.code));
  if (!ok) {
    live.wrong += 1;
    if (live.wrong >= MAX_WRONG_CODES) {
      cancelPairing();
      throw new PairingError(400, 'Too many wrong codes. Make a new code in the bridge and try again.');
    }
    throw new PairingError(400, 'That code is wrong. Check the code shown in the bridge.');
  }
  const cleanName = String(name ?? '').trim().slice(0, 60) || 'POS device';
  const token = randomBytes(32).toString('base64url');
  const device: StoredDevice = {
    id: randomUUID(),
    name: cleanName,
    tokenHash: sha256(token),
    pairedAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    lastAddress: address,
  };
  writeDevices([...readDevices(), device]);
  pairing = null;
  if (pairingTimer) clearTimeout(pairingTimer);
  pairingTimer = null;
  changed();
  return { token, device: publicView(device) };
}

/** The paired device a token belongs to, or null. Updates "last seen". */
export function authenticateDevice(token: string, address?: string): PairedDevice | null {
  if (!token || token.length > 200) return null;
  const hash = sha256(token);
  const devices = readDevices();
  const device = devices.find((d) => d.tokenHash.length === hash.length && timingSafeEqual(Buffer.from(d.tokenHash), Buffer.from(hash)));
  if (!device) return null;
  const now = Date.now();
  if (now - (lastSeenWrite.get(device.id) ?? 0) > SEEN_WRITE_EVERY_MS || device.lastAddress !== address) {
    lastSeenWrite.set(device.id, now);
    device.lastSeenAt = new Date(now).toISOString();
    device.lastAddress = address;
    writeDevices(devices);
    changed();
  }
  return publicView(device);
}

export function removeDevice(id: string): void {
  writeDevices(readDevices().filter((d) => d.id !== id));
  lastSeenWrite.delete(id);
  lanEvents.emit('device-removed', id);
  changed();
}

export function renameDevice(id: string, name: string): void {
  const clean = name.trim().slice(0, 60);
  if (!clean) throw new Error('Enter a name for the device.');
  writeDevices(readDevices().map((d) => (d.id === id ? { ...d, name: clean } : d)));
  changed();
}
