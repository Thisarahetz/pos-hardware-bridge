import { SerialPort } from 'serialport';
import type { TerminalConfig, TerminalChargeRequest, TerminalChargeResult } from '../types';
import type { TerminalDriver } from './terminal-driver';

const STX = 0x02;
const ETX = 0x03;

/**
 * Generic framing for in-house / white-label serial payment terminals:
 * request and response are both `STX + JSON + ETX` over the wire. This is NOT
 * a standard protocol — it's a sane default for terminals you control the
 * firmware of, or a serial<->terminal bridge you write yourself. Certified
 * terminals (Ingenico, Verifone, PAX, etc.) use their own binary protocols;
 * implement `TerminalDriver` again for those rather than editing this class,
 * so both can be swapped in from terminal.service.ts by config alone.
 */
export class GenericSerialTerminalDriver implements TerminalDriver {
  private port: SerialPort;
  private buffer = Buffer.alloc(0);
  private responseTimeoutMs: number;

  constructor(config: TerminalConfig) {
    this.responseTimeoutMs = config.responseTimeoutMs;
    this.port = new SerialPort({
      path: config.serialPath,
      baudRate: config.baudRate,
      autoOpen: true,
    });
    this.port.on('data', (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
    });
  }

  isConnected(): boolean {
    return this.port.isOpen;
  }

  private extractFrame(): Buffer | null {
    const start = this.buffer.indexOf(STX);
    const end = this.buffer.indexOf(ETX, start + 1);
    if (start === -1 || end === -1) return null;
    const frame = this.buffer.subarray(start + 1, end);
    this.buffer = this.buffer.subarray(end + 1);
    return frame;
  }

  private writeFrame(payload: Record<string, unknown>): Promise<void> {
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    const frame = Buffer.concat([Buffer.from([STX]), body, Buffer.from([ETX])]);
    return new Promise((resolve, reject) => {
      this.port.write(frame, (err) => (err ? reject(err) : resolve()));
    });
  }

  private waitForFrame(timeoutMs: number): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const poll = setInterval(() => {
        const frame = this.extractFrame();
        if (frame) {
          clearInterval(poll);
          try {
            resolve(JSON.parse(frame.toString('utf8')));
          } catch {
            reject(new Error('Malformed response from terminal'));
          }
          return;
        }
        if (Date.now() - start > timeoutMs) {
          clearInterval(poll);
          reject(new Error('Terminal response timed out'));
        }
      }, 100);
    });
  }

  async charge(request: TerminalChargeRequest): Promise<TerminalChargeResult> {
    if (!this.port.isOpen) {
      throw new Error('Terminal serial port is not open');
    }
    await this.writeFrame({
      command: 'charge',
      amountMinorUnits: request.amountMinorUnits,
      currency: request.currency,
      reference: request.reference,
    });

    try {
      const response = await this.waitForFrame(this.responseTimeoutMs);
      return {
        status: (response.status as TerminalChargeResult['status']) ?? 'error',
        reference: request.reference,
        authCode: response.authCode as string | undefined,
        cardLast4: response.cardLast4 as string | undefined,
        message: response.message as string | undefined,
      };
    } catch (err) {
      return {
        status: 'error',
        reference: request.reference,
        message: err instanceof Error ? err.message : 'Unknown terminal error',
      };
    }
  }

  async cancel(reference: string): Promise<void> {
    await this.writeFrame({ command: 'cancel', reference });
  }

  dispose(): void {
    if (this.port.isOpen) this.port.close();
  }
}
