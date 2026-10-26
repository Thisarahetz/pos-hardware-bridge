export { ReceiptBuilder } from './lines.js';
export type { ReceiptItem, RowBlockOptions, TextBlockOptions } from './lines.js';
export { layoutReceipt, wrapReceiptText, cleanReceiptText, RECEIPT_TEXT_SCALE } from './layout.js';
export type { ReceiptBlock, ReceiptDocument, ReceiptLayoutItem, ReceiptTextSize } from './layout.js';
export { Receipt, receipt, escapeText, escapeValue } from './receipt.js';
export type { Align, BarcodeOptions, ItemLine, QrOptions, TextSize, TextStyle } from './receipt.js';
export { BridgeClient, BridgeError } from './client.js';
export type {
  BridgeClientOptions,
  HealthInfo,
  PairOptions,
  PairResult,
  DeviceStatus,
  Preview,
  PrinterInfo,
  PrintOptions,
  PrintResult,
  StatusLevel,
} from './client.js';
export {
  DEFAULT_ROLES,
  DEFAULT_STORAGE_KEY,
  THIS_COMPUTER_URL,
  bridgeFor,
  connectToBridge,
  defaultPrintSettings,
  isPrintingConfigured,
  isThisComputerUrl,
  loadPrintSettings,
  onPrintSettingsChange,
  pairDevice,
  printFor,
  printInvoice,
  printTestPageFor,
  printerFor,
  savePrintSettings,
  summarizeStatus,
  watchPrinterStatus,
} from './pos.js';
export type {
  BridgeConnection,
  PrintForOptions,
  PrintOutcome,
  PrintRoleConfig,
  PrintSettings,
  PrinterStatusSummary,
  StorageOptions,
  WatchStatusOptions,
} from './pos.js';
