import React from 'react';
import { createRoot } from 'react-dom/client';
import { toJpeg, getFontEmbedCSS } from 'html-to-image';
import { IdCard, type IdCardProps } from './IdCard';
import { zipStore, type ZipEntry } from '../shared/zip';

/**
 * JPEG export for ID cards — used by the per-card "Download JPEG" buttons and
 * by the per-section batch download. The card is rendered off-screen through
 * the SAME IdCard component the modal and the printer use, so the image can
 * never drift from what prints.
 */

const JPEG_QUALITY = 0.92;
// 2× the 320px card → 640px-wide JPEGs, crisp enough for a printed wallet ID.
const PIXEL_RATIO = 2;
const IMAGE_WAIT_MS = 3000;

/**
 * The web fonts (Playfair Display / Plus Jakarta Sans) are embedded once and
 * reused for every card in a batch — re-fetching them per card made a batch
 * roughly 4× slower. Empty string means "fonts unreachable (offline kiosk):
 * render without embedding", and the next attempt retries the fetch.
 */
let fontCssPromise: Promise<string | null> | null = null;
async function sharedFontCss(node: HTMLElement): Promise<string> {
  if (!fontCssPromise) {
    fontCssPromise = getFontEmbedCSS(node).catch(() => null);
  }
  const css = await fontCssPromise;
  if (css === null) { fontCssPromise = null; return ''; }
  return css;
}

/** Resolves once every <img> in the host is decoded (QR codes render async). */
function waitForImages(host: HTMLElement): Promise<void> {
  return new Promise(resolve => {
    const start = Date.now();
    const tick = (): void => {
      const imgs = Array.from(host.querySelectorAll('img'));
      const ready = imgs.length > 0 && imgs.every(i => i.complete && i.naturalWidth > 0);
      if (ready || Date.now() - start > IMAGE_WAIT_MS) { resolve(); return; }
      setTimeout(tick, 40);
    };
    tick();
  });
}

/** Renders one ID card off-screen and returns it as a JPEG data URL. */
export async function renderIdCardJpeg(spec: IdCardProps): Promise<string> {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;padding:0;margin:0;background:#ffffff;';
  document.body.appendChild(host);
  const root = createRoot(host);
  root.render(<IdCard {...spec} />);
  try {
    await waitForImages(host);
    const card = host.querySelector('.id-card-render') as HTMLElement | null;
    if (!card) throw new Error('ID card did not render');
    // Tight crop: the print-style drop shadow would be half-clipped in a JPEG.
    card.style.boxShadow = 'none';
    const opts = {
      quality: JPEG_QUALITY,
      pixelRatio: PIXEL_RATIO,
      backgroundColor: '#ffffff',
      fontEmbedCSS: await sharedFontCss(card)
    };
    try {
      return await toJpeg(card, opts);
    } catch {
      // Web fonts may be unreachable (offline kiosk); retry without embedding
      // them rather than failing the export entirely.
      return await toJpeg(card, { ...opts, skipFonts: true });
    }
  } finally {
    root.unmount();
    host.remove();
  }
}

/** Safe ASCII file name for downloads (section names contain "•" etc.). */
export function safeFileName(name: string): string {
  const clean = name.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '');
  return clean || 'id-card';
}

/** Triggers a browser/Electron download of a data URL (single JPEG). */
export function downloadDataUrl(dataUrl: string, filename: string): void {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = safeFileName(filename);
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export interface IdCardZipItem {
  /** File name inside the ZIP, e.g. "Dela_Cruz_Juan_S-2026-00417.jpg" */
  file: string;
  card: IdCardProps;
}

/**
 * Renders every card, packs the JPEGs into one ZIP and downloads it as a
 * single file. `onProgress(done, total)` drives the button label while the
 * (roughly 200ms per card) batch runs.
 */
export async function downloadIdCardsZip(
  items: IdCardZipItem[],
  zipFileName: string,
  onProgress?: (done: number, total: number) => void
): Promise<void> {
  const entries: ZipEntry[] = [];
  const used = new Set<string>();
  for (let i = 0; i < items.length; i++) {
    const { file, card } = items[i];
    const jpeg = await renderIdCardJpeg(card);
    let name = `${safeFileName(file)}.jpg`;
    let n = 1;
    while (used.has(name)) name = `${safeFileName(file)}_${n++}.jpg`;   // duplicate names/QRs
    used.add(name);
    entries.push({ name, data: dataUrlToBytes(jpeg) });
    onProgress?.(i + 1, items.length);
    // Yield so React paints the progress label between renders.
    await new Promise(r => setTimeout(r, 0));
  }

  const blob = new Blob([zipStore(entries)], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeFileName(zipFileName)}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
