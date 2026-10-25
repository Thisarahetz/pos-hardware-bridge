import { app } from 'electron';
import { Bonjour, type Service } from 'bonjour-service';
import { getConfig } from '../config-store';
import { log } from '../logger';
import { bridgeId, bridgeName } from './devices';

/**
 * Announce the bridge on the shop network (mDNS / Bonjour, service type
 * `_pos-bridge._tcp`), so a POS app can find it without anyone typing an IP
 * address. Only while network access is turned on.
 */

export const SERVICE_TYPE = 'pos-bridge';

let bonjour: Bonjour | null = null;
let service: Service | null = null;

export function startAdvertising(): void {
  stopAdvertising();
  const { allowNetwork, port } = getConfig().server;
  if (!allowNetwork) return;
  try {
    bonjour = new Bonjour();
    service = bonjour.publish({
      name: `POS Hardware Bridge (${bridgeName()})`,
      type: SERVICE_TYPE,
      port,
      txt: { id: bridgeId(), name: bridgeName(), version: app.getVersion(), api: '1' },
    });
    service.on('error', (err: Error) => log.warn(`network discovery: ${err.message}`));
    log.info(`announcing _${SERVICE_TYPE}._tcp on port ${port}`);
  } catch (err) {
    // Discovery is a convenience: typing the address still works.
    log.warn(`network discovery could not start: ${err instanceof Error ? err.message : err}`);
    stopAdvertising();
  }
}

export function stopAdvertising(): void {
  try {
    service?.stop?.();
    bonjour?.unpublishAll();
    bonjour?.destroy();
  } catch {
    // shutting down anyway
  }
  service = null;
  bonjour = null;
}
