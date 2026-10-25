import express from 'express';
import { app as electronApp } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { Server } from 'node:http';
import { createServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { getConfig, UnknownPrinterError } from './config-store';
import { displayAddress, identifyUpgrade, localOnly, networkGate, requireAuthToken, type Caller } from './auth';
import { bridgeId, bridgeName, lanEvents, pairDevice, PairingError } from './lan/devices';
import { startAdvertising, stopAdvertising } from './lan/advertise';
import { printDocument, printHtmlPage, printReceipt, printTestPage } from './printer/printer.service';
import { previewReceiptLine, printReceiptLine } from './printer/receiptline.service';
import { charge, cancel, terminalStatus, terminalEvents } from './terminal/terminal.service';
import type { BridgeStatus } from './types';
import { getStatus, refreshStatus, statusEvents } from './status-monitor';
import { log } from './logger';
import { validateCharge, validateDocument, validatePage, validatePrinterChoice, validateReceipt, validateReceiptLine, validateReference } from './validation';

let httpServer: Server | null = null;
let wss: WebSocketServer | null = null;
/** Who each live WebSocket belongs to: payment events go to local callers only. */
const socketCallers = new WeakMap<WebSocket, Caller>();

function broadcast(event: string, payload: unknown, localOnlyEvent = false): void {
  const message = JSON.stringify({ event, payload });
  wss?.clients.forEach((client: WebSocket) => {
    if (client.readyState !== client.OPEN) return;
    if (localOnlyEvent && socketCallers.get(client)?.kind !== 'local') return;
    client.send(message);
  });
}

/** Where the API docs live: next to dist/ in development and inside the app when packaged. */
const DOCS_DIR = path.join(__dirname, '../../docs');

/** Pairing guesses per address per minute: a 6-digit code must not be brute-forced. */
const pairAttempts = new Map<string, { count: number; resetAt: number }>();
function tooManyPairAttempts(address: string): boolean {
  const now = Date.now();
  const entry = pairAttempts.get(address);
  if (!entry || entry.resetAt < now) {
    pairAttempts.set(address, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  entry.count += 1;
  return entry.count > 10;
}

/** 404 for an unknown printer name, 502 for a device problem the cashier can fix. */
function sendPrintError(res: express.Response, err: unknown): void {
  const message = err instanceof Error ? err.message : 'print failed';
  res.status(err instanceof UnknownPrinterError ? 404 : 502).json({ error: message });
}

function buildApp() {
  const app = express();
  // Large enough for an A4 invoice sent as a base64 PDF with images.
  app.use(express.json({ limit: '20mb' }));

  // CORS: any localhost origin may call this (POS web apps typically run on
  // e.g. http://localhost:3140), but the bearer token below is the real gate.
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', req.header('origin') ?? '*');
    res.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    // Chrome's Private Network Access: a POS served from an https:// website
    // must be explicitly allowed to call this local address.
    if (req.header('access-control-request-private-network') === 'true') {
      res.header('Access-Control-Allow-Private-Network', 'true');
    }
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });
  app.use(networkGate);

  // API docs, readable in a browser at http://127.0.0.1:9191/docs
  const SPECS = ['openapi.yaml', 'print-station.openapi.yaml'];
  app.get([...SPECS.map((f) => `/${f}`), ...SPECS.map((f) => `/docs/${f}`)], (req, res) => {
    res.type('application/yaml');
    res.sendFile(path.join(DOCS_DIR, path.basename(req.path)), (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: 'API spec not found in this build' });
    });
  });
  app.get(['/docs', '/docs/'], (_req, res) => {
    const file = path.join(DOCS_DIR, 'index.html');
    if (!fs.existsSync(file)) {
      res.status(404).json({ error: 'API docs not found in this build' });
      return;
    }
    res.sendFile(file);
  });

  // A phone, tablet or till on the shop network swaps the 6-digit code shown
  // in the bridge for its own token.
  app.post('/pair', (req, res) => {
    const address = displayAddress(req.socket.remoteAddress) ?? 'unknown';
    if (tooManyPairAttempts(address)) {
      res.status(429).json({ error: 'Too many attempts. Wait a minute and try again.' });
      return;
    }
    const { code, name } = (req.body ?? {}) as { code?: unknown; name?: unknown };
    if (typeof code !== 'string' && typeof code !== 'number') {
      res.status(400).json({ error: 'Invalid pairing request', details: ['"code" must be the 6-digit code shown in the bridge'] });
      return;
    }
    try {
      const { token, device } = pairDevice(String(code), typeof name === 'string' ? name : '', address);
      log.info(`paired device "${device.name}" from ${address}`);
      res.json({ token, deviceId: device.id, deviceName: device.name, bridge: { id: bridgeId(), name: bridgeName(), version: electronApp.getVersion() } });
    } catch (err) {
      if (err instanceof PairingError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      throw err;
    }
  });

  app.get('/health', (_req, res) => {
    const status = getStatus();
    res.json({
      ok: true,
      bridge: { id: bridgeId(), name: bridgeName(), version: electronApp.getVersion(), acceptsDevices: getConfig().server.allowNetwork },
      printer: getConfig().printers.length > 0,
      terminal: getConfig().terminal.enabled,
      printerReady: status?.printer.level === 'ok',
      terminalReady: status?.terminal.level === 'ok',
      printers: (status?.printers ?? []).map((p) => ({ id: p.id, kind: p.kind, ready: p.level === 'ok' })),
    });
  });

  app.use(requireAuthToken);

  // Which caller this is, so an app can show "paired as Kitchen tablet".
  app.get('/me', (_req, res) => {
    const caller = res.locals.caller as Caller;
    res.json(caller.kind === 'local' ? { kind: 'local' } : { kind: 'device', deviceId: caller.device.id, deviceName: caller.device.name });
  });

  // Full, human-readable device status so a POS can show "printer unplugged" etc.
  app.get('/status', async (_req, res) => {
    res.json(getStatus() ?? (await refreshStatus()));
  });

  // Every configured printer with its status, so the POS can offer a choice.
  app.get('/printers', async (_req, res) => {
    const status = getStatus() ?? (await refreshStatus());
    res.json(
      getConfig().printers.map((p, i, all) => {
        const s = status.printers.find((x) => x.id === p.id);
        return {
          id: p.id,
          name: p.name,
          kind: p.kind,
          isDefault: all.findIndex((x) => x.kind === p.kind) === i,
          paperSize: p.kind === 'document' ? p.paperSize : undefined,
          paperWidthChars: p.kind === 'receipt' ? p.paperWidthChars : undefined,
          ready: s?.level === 'ok',
          status: s ? { level: s.level, title: s.title, detail: s.detail, steps: s.steps } : undefined,
        };
      }),
    );
  });

  app.post('/print/receipt', async (req, res) => {
    const input = validateReceipt(req.body);
    if (!input.ok) {
      res.status(400).json({ error: 'Invalid receipt', details: input.problems });
      return;
    }
    const { printer, cut, ...receipt } = input.value;
    try {
      const used = await printReceipt(receipt, printer, cut !== false);
      res.json({ ok: true, printer: used.id });
    } catch (err) {
      sendPrintError(res, err);
    }
  });

  app.post('/print/document', async (req, res) => {
    const input = validateDocument(req.body);
    if (!input.ok) {
      res.status(400).json({ error: 'Invalid document', details: input.problems });
      return;
    }
    try {
      const used = await printDocument(input.value);
      res.json({ ok: true, printer: used.id });
    } catch (err) {
      sendPrintError(res, err);
    }
  });

  // A ready-made HTML page (a bill as the POS lays it out): a thermal printer
  // prints it as an image at its print-head width, an A4/A5 printer through
  // its driver. Same path the cloud print station uses.
  app.post('/print/page', async (req, res) => {
    const input = validatePage(req.body);
    if (!input.ok) {
      res.status(400).json({ error: 'Invalid page', details: input.problems });
      return;
    }
    const { html, printer, format, copies, title } = input.value;
    try {
      const used = await printHtmlPage(html, printer, { format, copies, title });
      res.json({ ok: true, printer: used.id });
    } catch (err) {
      sendPrintError(res, err);
    }
  });

  // ReceiptLine (open receipt markup, https://github.com/receiptline/receiptline):
  // printed with the printer's own fonts — the recommended way to print receipts.
  app.post('/print/receiptline', async (req, res) => {
    const input = validateReceiptLine(req.body);
    if (!input.ok) {
      res.status(400).json({ error: 'Invalid ReceiptLine request', details: input.problems });
      return;
    }
    const { document, printer, copies, cut, title } = input.value;
    try {
      const used = await printReceiptLine(document, printer, { copies, cut, title });
      res.json({ ok: true, printer: used.id });
    } catch (err) {
      sendPrintError(res, err);
    }
  });

  /** The same document as an SVG, laid out exactly as the printer will print it. */
  app.post('/preview/receiptline', (req, res) => {
    const input = validateReceiptLine(req.body);
    if (!input.ok) {
      res.status(400).json({ error: 'Invalid ReceiptLine request', details: input.problems });
      return;
    }
    try {
      res.json(previewReceiptLine(input.value.document, input.value.printer));
    } catch (err) {
      sendPrintError(res, err);
    }
  });

  app.post('/print/test', async (req, res) => {
    const input = validatePrinterChoice(req.body);
    if (!input.ok) {
      res.status(400).json({ error: 'Invalid request', details: input.problems });
      return;
    }
    try {
      const used = await printTestPage(input.value.printer);
      res.json({ ok: true, printer: used.id });
    } catch (err) {
      sendPrintError(res, err);
    }
  });

  app.post('/terminal/charge', localOnly, async (req, res) => {
    const input = validateCharge(req.body);
    if (!input.ok) {
      res.status(400).json({ error: 'Invalid charge request', details: input.problems });
      return;
    }
    try {
      const result = await charge(input.value);
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'charge failed' });
    }
  });

  app.post('/terminal/cancel', localOnly, async (req, res) => {
    const input = validateReference(req.body);
    if (!input.ok) {
      res.status(400).json({ error: 'Invalid cancel request', details: input.problems });
      return;
    }
    try {
      await cancel(input.value.reference);
      res.json({ ok: true });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'cancel failed' });
    }
  });

  app.get('/terminal/status', localOnly, (_req, res) => {
    res.json(terminalStatus());
  });

  // Malformed JSON and other unexpected errors: always answer in JSON.
  app.use((err: Error & { status?: number; type?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err.type === 'entity.parse.failed') {
      res.status(400).json({ error: 'Request body is not valid JSON' });
      return;
    }
    log.error('request failed', err);
    res.status(err.status ?? 500).json({ error: err.message || 'Internal error' });
  });

  return app;
}

let running = false;
let lastError: string | undefined;
let retryTimer: NodeJS.Timeout | null = null;

export function serverState(): { running: boolean; error?: string } {
  return { running, error: lastError };
}

function onTerminalStatus(payload: unknown): void {
  broadcast('terminal.status', payload, true);
}

/** A removed device loses its live connection too, not just future requests. */
function onDeviceRemoved(id: string): void {
  wss?.clients.forEach((client: WebSocket) => {
    const caller = socketCallers.get(client);
    if (caller?.kind === 'device' && caller.device.id === id) client.close(4401, 'device removed');
  });
}

function onStatusChange(status: BridgeStatus): void {
  broadcast('bridge.status', status);
}

export function startServer(): void {
  if (httpServer) return;
  const { port, allowNetwork } = getConfig().server;
  const host = allowNetwork ? '0.0.0.0' : '127.0.0.1';
  const app = buildApp();
  const server = createServer(app);
  httpServer = server;
  wss = new WebSocketServer({
    server,
    path: '/events',
    // Payment events include card details, so require the token here too.
    verifyClient: ({ req }: { req: import('node:http').IncomingMessage }, done: (ok: boolean, code?: number, message?: string) => void) => {
      const verdict = identifyUpgrade(req);
      if (!verdict.ok) return done(false, verdict.status, verdict.error);
      (req as import('node:http').IncomingMessage & { caller?: Caller }).caller = verdict.caller;
      done(true);
    },
  });
  wss.on('connection', (socket: WebSocket, req: import('node:http').IncomingMessage & { caller?: Caller }) => {
    if (req.caller) socketCallers.set(socket, req.caller);
  });
  wss.on('error', () => {
    // Errors are surfaced through the HTTP server's own 'error' handler below.
  });

  terminalEvents.on('status', onTerminalStatus);
  statusEvents.on('change', onStatusChange);
  lanEvents.on('device-removed', onDeviceRemoved);

  server.on('listening', () => {
    running = true;
    lastError = undefined;
    log.info(`API listening on ${host}:${port}${allowNetwork ? ' (shop network allowed)' : ''}`);
    startAdvertising();
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    running = false;
    lastError =
      err.code === 'EADDRINUSE'
        ? `Port ${port} is used by another program. Retrying…`
        : `API could not start: ${err.message}`;
    log.error('API server error', err);
    // Keep trying: the other program may close, or the OS may still be releasing the port.
    stopServer();
    retryTimer = setTimeout(() => {
      retryTimer = null;
      startServer();
    }, 5000);
  });

  // Loopback only unless the shop turned on network access; even then, other
  // machines need a paired device token (see auth.ts).
  server.listen(port, host);
}

export function stopServer(): void {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  statusEvents.off('change', onStatusChange);
  terminalEvents.off('status', onTerminalStatus);
  lanEvents.off('device-removed', onDeviceRemoved);
  stopAdvertising();
  wss?.close();
  wss = null;
  httpServer?.close();
  httpServer = null;
  running = false;
}

export function restartServer(): void {
  stopServer();
  startServer();
}
