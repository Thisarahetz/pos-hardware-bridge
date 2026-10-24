import { app, BrowserWindow, nativeImage, type NativeImage } from 'electron';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { printSandbox } from './print-sandbox';

/** Tallest page we render: about 1.5 m of 80mm receipt. */
const MAX_HEIGHT_DOTS = 12_000;
/** Rows per raster command: many cheap printers choke on one huge image. */
const CHUNK_ROWS = 256;
/** Blank dots kept under the last printed line. */
const BOTTOM_MARGIN_DOTS = 8;
const LOAD_TIMEOUT_MS = 20_000;

export interface RasterOptions {
  /** Printable width of the paper in printer dots (384 for 58mm, 576 for 80mm). */
  dots: number;
  /** Width, in CSS px, the page was laid out for (80mm ≈ 302 px). */
  cssWidth: number;
}

/** Anything darker than this prints. Higher than the driver's own 50 % so the
 *  light-grey text bills use for small print still shows on thermal paper. */
const INK_THRESHOLD = 200;

/** Turn a BGRA bitmap into pure black and white, in place. Returns the last
 *  row with any ink, or -1 for a blank page. */
function toBlackAndWhite(bitmap: Buffer, width: number, height: number): number {
  let last = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      const i = row + x * 4;
      const gray = 0.0722 * bitmap[i] + 0.7152 * bitmap[i + 1] + 0.2126 * bitmap[i + 2];
      const ink = bitmap[i + 3] > 126 && gray < INK_THRESHOLD;
      const v = ink ? 0 : 255;
      bitmap[i] = v;
      bitmap[i + 1] = v;
      bitmap[i + 2] = v;
      bitmap[i + 3] = 255;
      if (ink) last = y;
    }
  }
  return last;
}

/**
 * Render an HTML page (a bill laid out for a receipt roll) to black-and-white
 * PNG strips exactly as wide as the printer's print head, so the shop's own
 * bill design — logo, QR code, fonts — prints on any ESC/POS or Star printer
 * without a driver. Scripts are off and the page has no network access.
 */
export async function renderHtmlToRaster(html: string, options: RasterOptions): Promise<Buffer[]> {
  const file = path.join(app.getPath('temp'), `pos-bridge-${randomUUID()}.html`);
  await fs.writeFile(file, html);
  const win = new BrowserWindow({
    show: false,
    width: options.dots,
    height: MAX_HEIGHT_DOTS,
    useContentSize: true,
    enableLargerThanScreen: true,
    webPreferences: {
      offscreen: true,
      javascript: false,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      ...printSandbox(),
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  try {
    await Promise.race([
      win.loadFile(file),
      new Promise((_, reject) => setTimeout(() => reject(new Error('The bill took too long to load')), LOAD_TIMEOUT_MS)),
    ]);
    // Lay the page out at the width it was designed for, scaled to the head.
    win.webContents.setZoomFactor(options.dots / options.cssWidth);
    // A page a pixel wider than the head after scaling would get a scrollbar,
    // which reads as ink along the bottom edge. Paper has no scrollbars.
    await win.webContents.insertCSS('html, body { overflow: hidden !important; } ::-webkit-scrollbar { display: none; }');
    // Let the zoomed layout and any inline images paint.
    await new Promise((resolve) => setTimeout(resolve, 250));
    const captured: NativeImage = await win.webContents.capturePage();
    const { width, height } = captured.getSize();
    const bitmap = captured.toBitmap();
    const end = toBlackAndWhite(bitmap, width, height);
    if (end < 0) throw new Error('The bill came out blank');
    const image = nativeImage.createFromBitmap(bitmap, { width, height });
    const total = Math.min(height, end + 1 + BOTTOM_MARGIN_DOTS);
    const strips: Buffer[] = [];
    for (let y = 0; y < total; y += CHUNK_ROWS) {
      strips.push(image.crop({ x: 0, y, width, height: Math.min(CHUNK_ROWS, total - y) }).toPNG());
    }
    return strips;
  } finally {
    win.destroy();
    await fs.rm(file, { force: true });
  }
}
