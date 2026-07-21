import { printer as ThermalPrinter, types as PrinterTypes } from 'node-thermal-printer';
import { getConfig } from '../config-store';
import type { PrinterConfig, ReceiptModel } from '../types';

function buildInterfaceString(config: PrinterConfig): string {
  if (config.connectionType === 'network') {
    return `tcp://${config.network.host}:${config.network.port}`;
  }
  const name = config.usb.systemPrinterName?.trim();
  if (!name) {
    throw new Error('No system printer name configured for USB printer');
  }
  return `printer:${name}`;
}

function buildDriver(config: PrinterConfig) {
  return new ThermalPrinter({
    type: config.driver === 'star' ? PrinterTypes.STAR : PrinterTypes.EPSON,
    interface: buildInterfaceString(config),
    width: config.paperWidthChars,
    removeSpecialCharacters: false,
    options: { timeout: 5000 },
  });
}

function money(amountMinorUnits: number, currency: string): string {
  return `${(amountMinorUnits / 100).toFixed(2)} ${currency}`;
}

function renderReceipt(driver: ReturnType<typeof buildDriver>, receipt: ReceiptModel): void {
  driver.alignCenter();
  driver.bold(true);
  driver.println(receipt.businessName);
  driver.bold(false);
  if (receipt.locationName) driver.println(receipt.locationName);
  driver.drawLine();

  driver.alignLeft();
  driver.println(`Sale: ${receipt.saleReference}`);
  driver.println(receipt.timestamp);
  driver.drawLine();

  for (const line of receipt.lines) {
    const qtyPrefix = line.qty && line.qty > 1 ? `${line.qty}x ` : '';
    driver.tableCustom([
      { text: `${qtyPrefix}${line.label}`, align: 'LEFT', width: 0.6 },
      { text: money(line.totalAmount, receipt.currency), align: 'RIGHT', width: 0.4 },
    ]);
  }
  driver.drawLine();

  driver.tableCustom([
    { text: 'Subtotal', align: 'LEFT', width: 0.6 },
    { text: money(receipt.subtotalAmount, receipt.currency), align: 'RIGHT', width: 0.4 },
  ]);
  driver.tableCustom([
    { text: 'Tax', align: 'LEFT', width: 0.6 },
    { text: money(receipt.taxAmount, receipt.currency), align: 'RIGHT', width: 0.4 },
  ]);
  driver.bold(true);
  driver.tableCustom([
    { text: 'Total', align: 'LEFT', width: 0.6 },
    { text: money(receipt.totalAmount, receipt.currency), align: 'RIGHT', width: 0.4 },
  ]);
  driver.bold(false);
  driver.println(`Paid by ${receipt.paymentMethod}`);

  if (receipt.footer) {
    driver.drawLine();
    driver.alignCenter();
    driver.println(receipt.footer);
  }

  driver.cut();
}

export async function printReceipt(receipt: ReceiptModel): Promise<void> {
  const config = getConfig().printer;
  if (!config.enabled) {
    throw new Error('Printer is disabled in settings');
  }
  const driver = buildDriver(config);
  renderReceipt(driver, receipt);
  const connected = await driver.isPrinterConnected().catch(() => false);
  if (!connected) {
    throw new Error('Printer not reachable');
  }
  await driver.execute();
}

export async function printTestPage(): Promise<void> {
  const config = getConfig().printer;
  const driver = buildDriver(config);
  driver.alignCenter();
  driver.bold(true);
  driver.println('POS Hardware Bridge');
  driver.bold(false);
  driver.println('Test print OK');
  driver.println(new Date().toISOString());
  driver.cut();
  await driver.execute();
}

export async function printRaw(escposBase64: string): Promise<void> {
  const config = getConfig().printer;
  const driver = buildDriver(config);
  driver.raw(Buffer.from(escposBase64, 'base64'));
  await driver.execute();
}
