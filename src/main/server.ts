import express from 'express';
import type { Server } from 'node:http';
import { createServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { getConfig } from './config-store';
import { requireAuthToken } from './auth';
import { printReceipt, printTestPage } from './printer/printer.service';
import { charge, cancel, terminalStatus, terminalEvents } from './terminal/terminal.service';
import type { ReceiptModel, TerminalChargeRequest } from './types';

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
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.get('/health', (_req, res) => {
    res.json({ ok: true, printer: getConfig().printer.enabled, terminal: getConfig().terminal.enabled });
  });

  app.use(requireAuthToken);

  app.post('/print/receipt', async (req, res) => {
    try {
      await printReceipt(req.body as ReceiptModel);
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
    try {
      const result = await charge(req.body as TerminalChargeRequest);
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'charge failed' });
    }
  });

  app.post('/terminal/cancel', async (req, res) => {
    try {
      await cancel((req.body as { reference: string }).reference);
      res.json({ ok: true });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'cancel failed' });
    }
  });

  app.get('/terminal/status', (_req, res) => {
    res.json(terminalStatus());
  });

  return app;
}

export function startServer(): void {
  if (httpServer) return;
  const { port } = getConfig().server;
  const app = buildApp();
  httpServer = createServer(app);
  wss = new WebSocketServer({ server: httpServer, path: '/events' });

  terminalEvents.on('status', (payload) => broadcast('terminal.status', payload));

  // Bind to loopback only — this server must never be reachable off the machine.
  httpServer.listen(port, '127.0.0.1');
}

export function stopServer(): void {
  wss?.close();
  wss = null;
  httpServer?.close();
  httpServer = null;
}

export function restartServer(): void {
  stopServer();
  startServer();
}
