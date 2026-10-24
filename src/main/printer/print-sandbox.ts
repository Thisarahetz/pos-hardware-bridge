import { session, type Session } from 'electron';

const PARTITION = 'pos-print-sandbox';
let configured: Session | null = null;

/**
 * The browser session every print job's page is rendered in. Pages come from
 * the POS (and, through the cloud, from any device in the shop), so they get
 * no network at all: only the page's own temp file and inline `data:` URLs
 * (an embedded logo or QR code) load. Scripts are already off for print
 * windows; this also stops a page from fetching or reporting anything.
 */
export function printSandbox(): { partition: string } {
  if (!configured) {
    configured = session.fromPartition(PARTITION);
    configured.webRequest.onBeforeRequest((details, callback) => {
      const allowed = details.url.startsWith('file://') || details.url.startsWith('data:');
      callback({ cancel: !allowed });
    });
    configured.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  }
  return { partition: PARTITION };
}
