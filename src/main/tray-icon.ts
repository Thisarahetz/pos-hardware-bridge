import { nativeImage, type NativeImage } from 'electron';
import { draw, toPng } from './icon-draw';
import type { StatusLevel } from './types';

const cache = new Map<StatusLevel, NativeImage>();

export function trayIcon(level: StatusLevel): NativeImage {
  const hit = cache.get(level);
  if (hit) return hit;
  const image = nativeImage.createFromBuffer(toPng(draw(16, level), 16), { scaleFactor: 1 });
  image.addRepresentation({ buffer: toPng(draw(32, level), 32), scaleFactor: 2 });
  cache.set(level, image);
  return image;
}
