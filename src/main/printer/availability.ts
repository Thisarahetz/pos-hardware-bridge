import { getBackend } from './backend';

/** Check an OS print queue can print right now. A job queued for an unplugged
 * printer would print later as a surprise duplicate, so refuse instead. */
export async function ensureQueueReady(queueName: string, kind?: 'receipt' | 'document'): Promise<void> {
  const backend = getBackend();
  const [queues, usb] = await Promise.all([backend.listQueues(), backend.listUsbDevices()]);
  const queue = queues.find((q) => q.name === queueName);
  if (!queue) throw new Error(`Printer “${queueName}” is not installed on this computer.`);

  if (!queue.enabled) {
    throw new Error('Printing is paused or offline in Windows. Open bridge settings and click “Resume printing”, or uncheck “Use Printer Offline” in Windows.');
  }

  if (kind !== 'document' && queue.connection === 'usb' && usb.length > 0 && queue.usbDeviceId && !usb.some((d) => d.id === queue.usbDeviceId)) {
    throw new Error('Printer not reachable. Make sure the USB cable is plugged in and the printer is turned on.');
  }
}
