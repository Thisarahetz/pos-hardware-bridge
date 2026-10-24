import express from 'express';
import type { Server } from 'node:http';
import { createServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { getConfig } from './config-store';
import { isValidToken, requireAuthToken } from './auth';
import { printReceipt, printTestPage } from './printer/printer.service';
import { charge, cancel, terminalStatus, terminalEvents } from './terminal/terminal.service';
import type { BridgeStatus } from './types';
import { getStatus, refreshStatus, statusEvents } from './status-monitor';
import { log } from './logger';
import { validateCharge, validateReceipt, validateReference } from './validation';

let httpServer: Server | null = null;
let wss: WebSocketServer | null = null;

function broadcast(event: string, payload: unknown): void {
  const message = JSON.stringify({ event, payload });
  wss?.clients.forEach((client: WebSocket) => {
    if (client.readyState === client.OPEN) client.send(message);
  });
}

function buildApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

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

  app.get('/health', (_req, res) => {
    const status = getStatus();
    res.json({
      ok: true,
      printer: getConfig().printer.enabled,
      terminal: getConfig().terminal.enabled,
      printerReady: status?.printer.level === 'ok',
      terminalReady: status?.terminal.level === 'ok',
    });
  });

  app.use(requireAuthToken);

  // Full, human-readable device status so a POS can show "printer unplugged" etc.
  app.get('/status', async (_req, res) => {
    res.json(getStatus() ?? (await refreshStatus()));
  });

  app.post('/print/receipt', async (req, res) => {
    const input = validateReceipt(req.body);
    if (!input.ok) {
      res.status(400).json({ error: 'Invalid receipt', details: input.problems });
      return;
    }
    try {
      await printReceipt(input.value);
      res.json({ ok: true });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'print failed' });
    }
  });

  app.post('/print/test', async (_req, res) => {
    try {
      await printTestPage();
      res.json({ ok: true });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'print failed' });
    }
  });

  app.post('/terminal/charge', async (req, res) => {
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

  app.post('/terminal/cancel', async (req, res) => {
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

  app.get('/terminal/status', (_req, res) => {
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
  broadcast('terminal.status', payload);
}

function onStatusChange(status: BridgeStatus): void {
  broadcast('bridge.status', status);
}

export function startServer(): void {
  if (httpServer) return;
  const { port } = getConfig().server;
  const app = buildApp();
  const server = createServer(app);
  httpServer = server;
  wss = new WebSocketServer({
    server,
    path: '/events',
    // Payment events include card details, so require the token here too.
    verifyClient: ({ req }: { req: import('node:http').IncomingMessage }) =>
      isValidToken(new URL(req.url ?? '', 'http://127.0.0.1').searchParams.get('token')),
  });
  wss.on('error', () => {
    // Errors are surfaced through the HTTP server's own 'error' handler below.
  });

  terminalEvents.on('status', onTerminalStatus);
  statusEvents.on('change', onStatusChange);

  server.on('listening', () => {
    running = true;
    lastError = undefined;
    log.info(`API listening on 127.0.0.1:${port}`);
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

  // Bind to loopback only — this server must never be reachable off the machine.
  server.listen(port, '127.0.0.1');
}

export function stopServer(): void {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  statusEvents.off('change', onStatusChange);
  terminalEvents.off('status', onTerminalStatus);
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
