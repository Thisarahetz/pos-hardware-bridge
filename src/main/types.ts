/** What a printer is used for. Receipt printers get raw ESC/POS/Star commands;
 * document printers (A4/A5 office printers) print pages through the OS driver. */
export type PrinterKind = 'receipt' | 'document';

export type PrinterConnection =
  /** A printer installed in the OS print system (CUPS on mac/Linux, the Windows
   * spooler): USB, network or Wi-Fi printers all appear this way. */
  | { type: 'system'; queueName: string }
  /** A receipt printer reached directly over the network (raw port 9100). */
  | { type: 'tcp'; host: string; port: number };

/** Character sets thermal printers support (ReceiptLine names). */
export type ReceiptEncoding =
  | 'multilingual' | 'cp437' | 'cp852' | 'cp858' | 'cp860' | 'cp863' | 'cp865' | 'cp866' | 'cp1252'
  | 'cp932' | 'shiftjis' | 'cp936' | 'gb18030' | 'cp949' | 'ksc5601' | 'cp950' | 'big5' | 'tis620';

export type ReceiptCutter = 'full' | 'partial' | 'none';

export type DocumentPaperSize = 'A4' | 'A5' | 'Letter' | 'Legal';

export interface PrinterProfile {
  /** Short name the POS uses to pick this printer, e.g. "receipt", "invoice". */
  id: string;
  /** Friendly name shown in the settings window, e.g. "Front counter". */
  name: string;
  kind: PrinterKind;
  connection: PrinterConnection;
  /** Receipt printers: command language. */
  language: 'epson' | 'star';
  /** Receipt printers: character set for text (ReceiptLine encoding name). */
  encoding: ReceiptEncoding;
  /** Receipt printers: characters per line (58mm ≈ 32, 80mm ≈ 42–48). */
  paperWidthChars: number;
  /** Receipt printers: what happens at the end of a receipt. Printers without a
   * cutter ("none") get extra paper fed so the text clears the tear bar. */
  cutter: ReceiptCutter;
  /** Receipt printers: blank lines fed after the receipt, before cutting/tearing. */
  feedLines: number;
  /** Receipt printers: print QR codes as an image (works on every printer) or
   * with the printer's own QR command (sharper/faster, not on all models). */
  qrMode: 'image' | 'native';
  /** Document printers: default paper size. */
  paperSize: DocumentPaperSize;
}

/** Settings from before multi-printer support; migrated on startup. */
export interface LegacyPrinterConfig {
  enabled: boolean;
  connectionType: 'usb' | 'network';
  driver: 'epson' | 'star';
  usb: { systemPrinterName?: string };
  network: { host: string; port: number };
  paperWidthChars: number;
  autoDetect?: boolean;
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
  /** Let paired phones, tablets and other tills on the shop network print here.
   * Off: the API is reachable from this computer only (127.0.0.1). */
  allowNetwork: boolean;
}

export interface AppSettings {
  /** Start the bridge (in the tray) when the user signs in to the computer. */
  launchAtLogin: boolean;
  /** Set up a newly plugged-in receipt printer automatically when none is configured. */
  autoDetectPrinters: boolean;
}

export interface BridgeConfig {
  app: AppSettings;
  server: ServerConfig;
  /** In priority order: the first printer of each kind is that kind's default. */
  printers: PrinterProfile[];
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
  /** Optional QR code printed above the footer: a payment link, e-invoice,
   * order tracking or feedback page. A plain string is the QR content. */
  qrCode?: string | ReceiptQrCode;
  footer?: string;
}

export interface ReceiptQrCode {
  /** What the QR code contains, usually a URL. */
  data: string;
  /** Short line printed under the code, e.g. "Scan to leave a review". */
  label?: string;
  size?: 'small' | 'medium' | 'large';
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

export type StatusLevel = 'ok' | 'warning' | 'error' | 'off';

/** Plain-language device status shown in the tray, the settings window and /status. */
export interface DeviceStatus {
  level: StatusLevel;
  title: string;
  detail: string;
  /** What the operator should do next, in order. Empty when everything is fine. */
  steps: string[];
  /** Optional one-click fix the settings window can offer. */
  action?: 'resume-queue' | 'clear-queue' | 'setup-printer';
}

export interface PrinterStatus extends DeviceStatus {
  id: string;
  name: string;
  kind: PrinterKind;
}

export interface BridgeStatus {
  /** Status of every configured printer, in priority order. */
  printers: PrinterStatus[];
  /** Summary for the default receipt printer (or "no printer set up"). Kept for older POS integrations. */
  printer: DeviceStatus;
  terminal: DeviceStatus;
  api: { url: string; running: boolean; error?: string };
  checkedAt: string;
}
