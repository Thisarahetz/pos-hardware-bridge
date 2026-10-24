/** OS print-system abstraction: CUPS on macOS/Linux, the Windows spooler on Windows.
 * Receipt printers are driven by sending raw ESC/POS bytes to an OS print queue. */

export interface PrintQueue {
  name: string;
  /** Friendly device name shown to the operator. */
  label: string;
  connection: 'usb' | 'network' | 'other';
  /** For USB queues: the id of the USB device it prints to (see UsbPrinterDevice.id). */
  usbDeviceId?: string;
  host?: string;
  port?: number;
  /** False when the OS has paused the queue or marked it offline. */
  enabled: boolean;
}

export interface UsbPrinterDevice {
  /** CUPS device URI (usb://…) or Windows port name (USB001). */
  id: string;
  label: string;
}

export interface PrinterBackend {
  listQueues(): Promise<PrintQueue[]>;
  /** USB printers physically connected right now. */
  listUsbDevices(): Promise<UsbPrinterDevice[]>;
  pendingJobs(queueName: string): Promise<number>;
  /** Create an OS print queue for a connected USB printer; returns its name. */
  installUsb(device: UsbPrinterDevice): Promise<string>;
  resume(queueName: string): Promise<void>;
  clear(queueName: string): Promise<void>;
  sendRaw(queueName: string, data: Buffer, docName: string): Promise<void>;
}

let backend: PrinterBackend | null = null;

export function getBackend(): PrinterBackend {
  if (!backend) {
    // Lazy require so each platform only loads its own implementation.
    backend =
      process.platform === 'win32'
        ? (require('./windows-backend') as typeof import('./windows-backend')).windowsBackend
        : (require('./cups-backend') as typeof import('./cups-backend')).cupsBackend;
  }
  return backend;
}

export function queueNameFor(label: string): string {
  const base = label.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'Printer';
  return `POS_${base}`;
}
