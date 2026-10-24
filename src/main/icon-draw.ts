/** Pure image drawing (no Electron), shared by the tray icon and the build-time app icon. */
import { deflateSync } from 'node:zlib';
import type { StatusLevel } from './types';

const COLORS: Record<StatusLevel, [number, number, number]> = {
  ok: [52, 199, 89],
  warning: [255, 179, 0],
  error: [255, 59, 48],
  off: [142, 142, 147],
};

/** Draws a receipt-shaped glyph with a status dot, so no image assets are needed. */
export function draw(size: number, level: StatusLevel): Buffer {
  const buf = Buffer.alloc(size * size * 4);
  const s = size / 16;
  const [r, g, b] = COLORS[level];

  const put = (x: number, y: number, cr: number, cg: number, cb: number, alpha: number) => {
    if (x < 0 || y < 0 || x >= size || y >= size || alpha <= 0) return;
    const i = (y * size + x) * 4;
    const a = Math.min(1, alpha);
    // BGRA, premultiplied-free blend over whatever is already there.
    const prevA = buf[i + 3] / 255;
    const outA = a + prevA * (1 - a);
    buf[i] = Math.round((cb * a + buf[i] * prevA * (1 - a)) / (outA || 1));
    buf[i + 1] = Math.round((cg * a + buf[i + 1] * prevA * (1 - a)) / (outA || 1));
    buf[i + 2] = Math.round((cr * a + buf[i + 2] * prevA * (1 - a)) / (outA || 1));
    buf[i + 3] = Math.round(outA * 255);
  };

  // Receipt outline (grey so it reads on light and dark menu bars).
  const grey = 128;
  for (let y = Math.round(1 * s); y < Math.round(14 * s); y++) {
    for (let x = Math.round(2 * s); x < Math.round(11 * s); x++) {
      const edge =
        x < Math.round(3 * s) || x >= Math.round(10 * s) || y < Math.round(2 * s) || y >= Math.round(13 * s);
      const line = !edge && (y === Math.round(5 * s) || y === Math.round(8 * s)) && x >= Math.round(4 * s) && x < Math.round(9 * s);
      if (edge || line) put(x, y, grey, grey, grey, 1);
    }
  }

  // Status dot, bottom-right, anti-aliased.
  const cx = 11.5 * s;
  const cy = 11.5 * s;
  const radius = 4 * s;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      put(x, y, r, g, b, radius + 0.5 - d);
    }
  }
  return buf;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Encode a BGRA bitmap as a PNG. */
export function toPng(bgra: Buffer, size: number): Buffer {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = bgra[i + 2];
      raw[o + 1] = bgra[i + 1];
      raw[o + 2] = bgra[i];
      raw[o + 3] = bgra[i + 3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}


/** App icon: blue rounded square with a white receipt and a green dot. */
export function drawAppIcon(size: number): Buffer {
  const buf = Buffer.alloc(size * size * 4);
  const s = size / 64;
  const blend = (x: number, y: number, rgb: [number, number, number], alpha: number) => {
    if (alpha <= 0) return;
    const a = Math.min(1, alpha);
    const i = (y * size + x) * 4;
    const prevA = buf[i + 3] / 255;
    const outA = a + prevA * (1 - a);
    buf[i] = Math.round((rgb[2] * a + buf[i] * prevA * (1 - a)) / (outA || 1));
    buf[i + 1] = Math.round((rgb[1] * a + buf[i + 1] * prevA * (1 - a)) / (outA || 1));
    buf[i + 2] = Math.round((rgb[0] * a + buf[i + 2] * prevA * (1 - a)) / (outA || 1));
    buf[i + 3] = Math.round(outA * 255);
  };
  // Signed distance to a rounded rectangle (negative inside).
  const roundRect = (px: number, py: number, x0: number, y0: number, x1: number, y1: number, r: number) => {
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const qx = Math.abs(px - cx) - ((x1 - x0) / 2 - r);
    const qy = Math.abs(py - cy) - ((y1 - y0) / 2 - r);
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = (x + 0.5) / s;
      const py = (y + 0.5) / s;
      const aa = (d: number) => 0.5 - d * s;
      blend(x, y, [10, 132, 255], aa(roundRect(px, py, 2, 2, 62, 62, 14)));
      blend(x, y, [255, 255, 255], aa(roundRect(px, py, 17, 10, 47, 54, 3)));
      for (const ly of [20, 28, 36]) blend(x, y, [170, 178, 190], aa(roundRect(px, py, 22, ly, 42, ly + 3, 1.5)));
      blend(x, y, [52, 199, 89], aa(Math.hypot(px - 47, py - 47) - 10));
      blend(x, y, [255, 255, 255], aa(Math.abs(Math.hypot(px - 47, py - 47) - 10) - 1.2) * 0.9);
    }
  }
  return buf;
}
