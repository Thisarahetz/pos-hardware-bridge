import type { NextFunction, Request, Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { getConfig } from './config-store';

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Every POS-facing route requires `Authorization: Bearer <token>` matching the
 * locally-generated token shown in the settings window. This is not for remote
 * security (the server only binds 127.0.0.1) — it stops any other local page or
 * process from silently driving the printer/terminal without the operator
 * having copied the token into their POS app once. */
export function requireAuthToken(req: Request, res: Response, next: NextFunction): void {
  const header = req.header('authorization') ?? '';
  const [scheme, token] = header.split(' ');
  const expected = getConfig().server.authToken;

  if (scheme !== 'Bearer' || !token || !safeEqual(token, expected)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  next();
}
