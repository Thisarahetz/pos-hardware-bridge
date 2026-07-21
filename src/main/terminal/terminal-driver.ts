import type { TerminalChargeRequest, TerminalChargeResult } from '../types';

/** Every payment terminal integration implements this. Swap in a vendor-specific
 * driver (Ingenico, Verifone, PAX, etc.) here without touching server.ts —
 * only the framing/parsing in `charge` differs per vendor. */
export interface TerminalDriver {
  charge(request: TerminalChargeRequest): Promise<TerminalChargeResult>;
  cancel(reference: string): Promise<void>;
  isConnected(): boolean;
  dispose(): void;
}
