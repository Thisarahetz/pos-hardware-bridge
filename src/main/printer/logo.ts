import { nativeImage } from 'electron';
import type { ReceiptImageSize } from './receipt-layout';
import { printableDots } from './qr';

const WIDTH_SHARE: Record<ReceiptImageSize, number> = { small: 0.4, medium: 0.6, large: 0.8, full: 1 };

/** Decode a base64 PNG/JPEG (a `data:` prefix is fine) into an electron image. */
export function decodeImage(data: string) {
  const image = nativeImage.createFromBuffer(Buffer.from(data.replace(/^data:image\/[a-z+]+;base64,/i, '').replace(/\s/g, ''), 'base64'));
  if (image.isEmpty()) throw new Error('The picture could not be read. Send a PNG or JPEG as base64.');
  return image;
}

/**
 * Black-and-white PNG of a logo scaled to a share of the paper width. Transparent
 * areas become white (thermal heads would print them black) and grey is cut at
 * 50%, which keeps a typical black logo crisp.
 */
export function logoPngForReceipt(data: string, size: ReceiptImageSize, paperWidthChars: number): Buffer {
  const source = decodeImage(data);
  const target = Math.max(8, Math.floor(printableDots(paperWidthChars) * WIDTH_SHARE[size]));
  const scaled = source.getSize().width === target ? source : source.resize({ width: target, quality: 'best' });
  const { width, height } = scaled.getSize();
  const bgra = scaled.toBitmap();
  const out = Buffer.alloc(width * height * 4, 255);
  for (let i = 0; i < width * height; i++) {
    const a = bgra[i * 4 + 3] / 255;
    const luma = 0.114 * bgra[i * 4] + 0.587 * bgra[i * 4 + 1] + 0.299 * bgra[i * 4 + 2];
    const v = luma * a + 255 * (1 - a) < 128 ? 0 : 255;
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = v;
  }
  return nativeImage.createFromBitmap(out, { width, height }).toPNG();
}
