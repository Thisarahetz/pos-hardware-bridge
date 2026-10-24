import { getBackend } from './backend';

/** Check an OS print queue can print right now. A job queued for an unplugged
 * printer would print later as a surprise duplicate, so refuse instead. */
export async function ensureQueueReady(queueName: string): Promise<void> {
  const backend = getBackend();
  const [queues, usb] = await Promise.all([backend.listQueues(), backend.listUsbDevices()]);
  const queue = queues.find((q) => q.name === queueName);
  if (!queue) throw new Error('Unknown destination');
  if (queue.connection === 'usb' && !usb.some((d) => d.id === queue.usbDeviceId)) {
    throw new Error('Printer not reachable');
  }
  if (!queue.enabled) {
    throw new Error('Printing is paused on this computer. Open the bridge settings and click “Resume printing”.');
  }
}
