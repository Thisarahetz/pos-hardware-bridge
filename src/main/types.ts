export type PrinterConnectionType = 'usb' | 'network';

export interface PrinterConfig {
  enabled: boolean;
  connectionType: PrinterConnectionType;
  /** node-thermal-printer character set / interface hint. */
  driver: 'epson' | 'star';
  usb: {
    /** Name of the printer as installed in the OS print system (CUPS on
     * mac/Linux, print spooler on Windows). Thermal receipt printers are
     * almost always installed this way, which lets us send raw ESC/POS
     * bytes through the OS driver instead of claiming the USB device
     * directly (fragile permissions, one process at a time, no macOS
     * support without a kext). */
    systemPrinterName?: string;
  };
  network: {
    host: string;
    port: number;
  };
  paperWidthChars: number;
}

export interface TerminalConfig {
  enabled: boolean;
  serialPath: string;
  baudRate: number;
  /** Milliseconds to wait for a terminal response before treating the charge as failed. */
  responseTimeoutMs: number;
}

export interface ServerConfig {
  port: number;
  authToken: string;
}

export interface BridgeConfig {
  server: ServerConfig;
  printer: PrinterConfig;
  terminal: TerminalConfig;
}

export interface ReceiptLine {
  label: string;
  qty?: number;
  unitAmount?: number;
  totalAmount: number;
}

export interface ReceiptModel {
  businessName: string;
  locationName?: string;
  saleReference: string;
  timestamp: string;
  lines: ReceiptLine[];
  subtotalAmount: number;
  taxAmount: number;
  totalAmount: number;
  currency: string;
  paymentMethod: string;
  footer?: string;
}

export type TerminalTransactionStatus =
  | 'pending'
  | 'approved'
  | 'declined'
  | 'error'
  | 'cancelled';

export interface TerminalChargeRequest {
  amountMinorUnits: number;
  currency: string;
  reference: string;
}

export interface TerminalChargeResult {
  status: TerminalTransactionStatus;
  reference: string;
  authCode?: string;
  cardLast4?: string;
  message?: string;
}
