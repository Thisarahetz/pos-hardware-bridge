import type { NextFunction, Request, Response } from 'express';
import type { IncomingMessage } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { getConfig } from './config-store';
import { authenticateDevice, type PairedDevice } from './lan/devices';

/**
 * Two kinds of caller:
 * - **local**: a POS on this computer, with the access token from the
 *   settings window. Can do everything, including card payments.
 * - **device**: a phone, tablet or till on the shop network, with the token it
 *   got when it paired. Can print and read status, never touch the card
 *   terminal. Only accepted while "Let phones and tablets print here" is on.
 * The access token is refused from other machines: it was only ever meant to
 * leave this computer by being pasted into a local POS.
 */
export type Caller = { kind: 'local' } | { kind: 'device'; device: PairedDevice };

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function isLoopback(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

/** Strip the IPv4-mapped prefix for display ("::ffff:192.168.1.5" → "192.168.1.5"). */
export function displayAddress(address: string | undefined): string | undefined {
  return address?.replace(/^::ffff:/, '');
}

type Verdict = { ok: true; caller: Caller } | { ok: false; status: number; error: string };

export function identify(token: string | null | undefined, remoteAddress: string | undefined): Verdict {
  const local = isLoopback(remoteAddress);
  if (!token) return { ok: false, status: 401, error: 'unauthorized' };
  if (safeEqual(token, getConfig().server.authToken)) {
    if (local) return { ok: true, caller: { kind: 'local' } };
    return {
      ok: false,
      status: 403,
      error: 'The bridge access token only works on the printer computer. Pair this device instead (POST /pair with the code shown in the bridge).',
    };
  }
  if (!local && !getConfig().server.allowNetwork) return { ok: false, status: 403, error: 'This bridge does not accept devices from the network.' };
  const device = authenticateDevice(token, displayAddress(remoteAddress));
  if (device) return { ok: true, caller: { kind: 'device', device } };
  return { ok: false, status: 401, error: 'unauthorized' };
}

/** For WebSockets, where browsers can't send headers: `ws://…/events?token=<token>`. */
export function identifyUpgrade(req: IncomingMessage): Verdict {
  const token = new URL(req.url ?? '', 'http://127.0.0.1').searchParams.get('token');
  return identify(token, req.socket.remoteAddress);
}

export function callerOf(res: Response): Caller {
  return res.locals.caller as Caller;
}

export function requireAuthToken(req: Request, res: Response, next: NextFunction): void {
  const [scheme, token] = (req.header('authorization') ?? '').split(' ');
  const verdict = identify(scheme === 'Bearer' ? token : null, req.socket.remoteAddress);
  if (!verdict.ok) {
    res.status(verdict.status).json({ error: verdict.error });
    return;
  }
  res.locals.caller = verdict.caller;
  next();
}

/** Card payments stay on the till the terminal is plugged into. */
export function localOnly(_req: Request, res: Response, next: NextFunction): void {
  if (callerOf(res).kind !== 'local') {
    res.status(403).json({ error: 'Card payments can only be started from the computer the card terminal is connected to.' });
    return;
  }
  next();
}

/** Anything not from this computer is refused while network access is off. */
export function networkGate(req: Request, res: Response, next: NextFunction): void {
  if (!isLoopback(req.socket.remoteAddress) && !getConfig().server.allowNetwork) {
    res.status(403).json({ error: 'This bridge does not accept devices from the network.' });
    return;
  }
  next();
}
