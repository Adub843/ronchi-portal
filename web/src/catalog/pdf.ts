// Opening a manual's PDF in the browser with pdf.js. The file never leaves the computer until
// staff press Save: only the parts tables that were read, and one image per drawing, are sent.
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PageText, TextItem } from "../../../src/shared/catalog/chapter11";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type Pdf = pdfjs.PDFDocumentProxy;

export async function openPdf(file: File): Promise<Pdf> {
  const data = new Uint8Array(await file.arrayBuffer());
  return pdfjs.getDocument({
    data,
    // Font and image helpers, copied next to the app at build time (see web/vite.config.ts).
    wasmUrl: "/pdfjs/wasm/",
    standardFontDataUrl: "/pdfjs/standard_fonts/",
    cMapUrl: "/pdfjs/cmaps/",
    cMapPacked: true,
  }).promise;
}

/** Every piece of text on a page with its position, top-left origin, as the chapter 11 reader expects. */
export async function pageText(doc: Pdf, n: number): Promise<PageText> {
  const page = await doc.getPage(n);
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const items: TextItem[] = [];
  for (const it of tc.items) {
    if (!("str" in it) || !it.str.trim()) continue;
    const m = pdfjs.Util.transform(vp.transform, it.transform) as number[];
    const size = Math.hypot(m[2]!, m[3]!);
    // Text turned on its side (vertical labels on drawings) isn't part of a table.
    if (Math.abs(m[1]!) > Math.abs(m[0]!)) continue;
    items.push({ str: it.str, x: m[4]!, y: m[5]! - size, w: it.width * vp.scale, h: size });
  }
  page.cleanup();
  return { page: n, width: vp.width, height: vp.height, items };
}

/**
 * Draw a page as an image for the catalog: sharp enough to zoom into the balloons, small
 * enough to load fast. WebP where the browser can make it (PNG on Safari).
 */
export async function pageImage(doc: Pdf, n: number, longSide = 3600): Promise<{ blob: Blob; w: number; h: number }> {
  const page = await doc.getPage(n);
  const vp1 = page.getViewport({ scale: 1 });
  let scale = longSide / Math.max(vp1.width, vp1.height);
  // Phones and some browsers limit canvas size.
  if (vp1.width * vp1.height * scale * scale > 16_000_000) scale = Math.sqrt(16_000_000 / (vp1.width * vp1.height));
  const vp = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(vp.width);
  canvas.height = Math.floor(vp.height);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
  page.cleanup();
  const blob = await new Promise<Blob>((ok, bad) => canvas.toBlob((b) => (b ? ok(b) : bad(new Error("The page couldn't be drawn."))), "image/webp", 0.82));
  return { blob, w: canvas.width, h: canvas.height };
}
