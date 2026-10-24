import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const MAX_BYTES = 1024 * 1024;

let file: string | null = null;

function logFile(): string | null {
  if (file) return file;
  try {
    const dir = app.getPath('logs');
    fs.mkdirSync(dir, { recursive: true });
    file = path.join(dir, 'bridge.log');
  } catch {
    file = null;
  }
  return file;
}

function format(value: unknown): string {
  if (value instanceof Error) return value.stack ?? value.message;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function write(level: string, parts: unknown[]): void {
  const line = `${new Date().toISOString()} ${level} ${parts.map(format).join(' ')}\n`;
  if (level !== 'INFO') process.stderr.write(line);
  const target = logFile();
  if (!target) return;
  try {
    // Keep one previous file so the log never grows without limit on a shop PC.
    if (fs.existsSync(target) && fs.statSync(target).size > MAX_BYTES) {
      fs.renameSync(target, `${target}.1`);
    }
    fs.appendFileSync(target, line);
  } catch {
    // Logging must never break printing.
  }
}

export const log = {
  info: (...parts: unknown[]) => write('INFO', parts),
  warn: (...parts: unknown[]) => write('WARN', parts),
  error: (...parts: unknown[]) => write('ERROR', parts),
  dir: () => (logFile() ? path.dirname(logFile() as string) : null),
};
