import QRCode from 'qrcode';
import type { ReceiptQrCode } from '../types';

export function normalizeQr(qr: string | ReceiptQrCode): Required<Pick<ReceiptQrCode, 'data' | 'size'>> & { label?: string } {
  return typeof qr === 'string' ? { data: qr, size: 'medium' } : { data: qr.data, label: qr.label, size: qr.size ?? 'medium' };
}

const WIDTH_SHARE = { small: 0.4, medium: 0.55, large: 0.7 } as const;

/** Thermal printers are 203 dpi: 58mm paper prints 384 dots, 80mm prints 576. */
function printableDots(paperWidthChars: number): number {
  return paperWidthChars <= 32 ? 384 : 576;
}

/** Black-and-white PNG of the QR code, sized in whole printer dots per module so
 * it stays crisp and scannable on thermal paper. */
export async function qrPngForReceipt(qr: ReturnType<typeof normalizeQr>, paperWidthChars: number): Promise<Buffer> {
  const margin = 2;
  const modules = QRCode.create(qr.data, { errorCorrectionLevel: 'M' }).modules.size;
  const target = printableDots(paperWidthChars) * WIDTH_SHARE[qr.size];
  const scale = Math.max(3, Math.floor(target / (modules + margin * 2)));
  return QRCode.toBuffer(qr.data, { type: 'png', errorCorrectionLevel: 'M', margin, scale, color: { dark: '#000000', light: '#ffffff' } });
}

/** Module size for the printer's built-in QR command (1–8). */
export function nativeCellSize(qr: ReturnType<typeof normalizeQr>, paperWidthChars: number): number {
  const base = paperWidthChars <= 32 ? 4 : 6;
  return Math.min(8, base + (qr.size === 'large' ? 2 : qr.size === 'small' ? -1 : 0));
}

/** Inline SVG for A4/A5 pages. */
export function qrSvg(data: string): Promise<string> {
  return QRCode.toString(data, { type: 'svg', errorCorrectionLevel: 'M', margin: 1 });
}
