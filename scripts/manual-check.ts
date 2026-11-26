// Read a machine manual's chapter 11 (Construction tables) on the PC, the same way the portal's
// "Import from manual" does in the browser, and report what it found. Nothing is sent anywhere.
//   npm run manual:check -- <chapter11.pdf> [<machine.stp> ...] [--json out.json]
// With STEP files it also says how many of the manual's parts list numbers those files cover.
import { readFileSync, writeFileSync } from "node:fs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { readChapter11, type PageText, type TextItem } from "../src/shared/catalog/chapter11";
import { readStepTree, type StepNode } from "../web/catalog/steptree";
import { codeOf } from "../web/catalog/codes";

const args = process.argv.slice(2);
const jsonAt = args.indexOf("--json");
const jsonOut = jsonAt >= 0 ? args[jsonAt + 1] : undefined;
const files = args.filter((a, i) => !a.startsWith("--") && !(jsonAt >= 0 && i === jsonAt + 1));
const pdfPath = files.find((f) => /\.pdf$/i.test(f));
const stepPaths = files.filter((f) => /\.ste?p$/i.test(f));
if (!pdfPath) { console.error("Give the chapter 11 PDF."); process.exit(2); }

// Same as web/src/catalog/pdf.ts pageText(), without the browser.
async function pageText(doc: pdfjs.PDFDocumentProxy, n: number): Promise<PageText> {
  const page = await doc.getPage(n);
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const items: TextItem[] = [];
  for (const it of tc.items) {
    if (!("str" in it) || !it.str.trim()) continue;
    const m = pdfjs.Util.transform(vp.transform, it.transform) as number[];
    const size = Math.hypot(m[2]!, m[3]!);
    if (Math.abs(m[1]!) > Math.abs(m[0]!)) continue;
    items.push({ str: it.str, x: m[4]!, y: m[5]! - size, w: it.width * vp.scale, h: size });
  }
  page.cleanup();
  return { page: n, width: vp.width, height: vp.height, items };
}

// Is a page's drawing made of lines (vector) or a picture (scan)?
async function drawingKind(doc: pdfjs.PDFDocumentProxy, n: number) {
  const page = await doc.getPage(n);
  const ops = await page.getOperatorList();
  let paths = 0, images = 0;
  for (const fn of ops.fnArray) {
    if (fn === pdfjs.OPS.constructPath) paths++;
    else if (fn === pdfjs.OPS.paintImageXObject || fn === pdfjs.OPS.paintInlineImageXObject || fn === pdfjs.OPS.paintImageMaskXObject) images++;
  }
  page.cleanup();
  return { page: n, paths, images, kind: images && paths < 50 ? "scanned image" : images ? "vector + image" : "vector" };
}

const t0 = Date.now();
const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(pdfPath)), useSystemFonts: true }).promise;
const pages: PageText[] = [];
for (let n = 1; n <= doc.numPages; n++) pages.push(await pageText(doc, n));
const { sheets, skipped } = readChapter11(pages);
const rows = sheets.reduce((n, s) => n + s.rows.length, 0);
const noBalloon = sheets.reduce((n, s) => n + s.rows.filter((r) => !s.balloons.some((b) => b.pos === r.pos)).length, 0);
const noCode = sheets.filter((s) => !s.code).length;
const warnings = sheets.flatMap((s) => s.warnings.map((w) => `p${s.page} ${s.code ?? "?"}: ${w}`));
const odd = sheets.flatMap((s) => s.rows.filter((r) => !r.code || !r.pos || (r.qty !== null && (r.qty <= 0 || r.qty > 500))).map((r) => `p${s.page} ${s.code ?? "?"} pos ${r.pos} ${r.code} qty ${r.qty}`));
const kinds = [];
for (const s of [sheets[0], sheets[Math.floor(sheets.length / 2)], sheets[sheets.length - 1]]) if (s) kinds.push(await drawingKind(doc, s.page));

const out: Record<string, unknown> = {
  pdf: pdfPath, seconds: (Date.now() - t0) / 1000, pages: doc.numPages, sheets: sheets.length, rows, skippedPages: skipped.length,
  sheetsWithoutNumber: noCode, rowsWithNoBalloon: noBalloon, warnings: warnings.length, warningSample: warnings.slice(0, 8),
  oddRows: odd.length, oddRowSample: odd.slice(0, 8),
  sample: sheets.filter((s) => s.code).filter((_, i, a) => i % Math.max(1, Math.floor(a.length / 5)) === 0).slice(0, 5).map((s) => ({ page: s.page, code: s.code, title: s.titleEn || s.titleIt, rows: s.rows.length })),
  drawings: kinds,
};

if (stepPaths.length) {
  const want = new Set(sheets.map((s) => s.code).filter((c): c is string => !!c).map((c) => c.toUpperCase()));
  const covered = new Set<string>();
  const perFile: Record<string, number> = {};
  for (const f of stepPaths) {
    const tree = readStepTree(new Uint8Array(readFileSync(f)));
    const here = new Set<string>();
    const fileCode = f.match(/(?:^|[_\\/])([A-Z]{2}\d{6})(?=_|\.)/i)?.[1]?.toUpperCase();
    if (fileCode && want.has(fileCode)) here.add(fileCode);
    const walk = (n: StepNode) => { const c = codeOf(n.name, {}); if (c && want.has(c)) here.add(c); n.children.forEach(walk); };
    if (tree) walk(tree);
    perFile[f] = here.size;
    here.forEach((c) => covered.add(c));
  }
  out.stepCoverage = { manualNumbers: want.size, covered: covered.size, perFile };
}

if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ ...out, sheetsFull: sheets.map((s) => ({ page: s.page, code: s.code, title: s.titleEn || s.titleIt, rows: s.rows.length })) }, null, 1));
console.log(JSON.stringify(out, null, 1));
