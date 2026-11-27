// Build a machine's parts catalog from its own manual, on the PC, for the machines nobody has
// imported by hand (Aaron, 2026-11-26: "you take the manual and build a 3d rendering off of that
// for all the machine that dont have one"). It does what the portal's "Import from manual" page
// does in the browser: reads chapter 11 (Construction tables) into parts lists with their balloon
// spots, and saves one picture per drawing. The 3D view then shows each drawing in space until a
// CAD model is loaded for that assembly (npm run cad:library fills those by assembly number).
//
//   node node_modules/.cache/manual-load.mjs [--dry-run] [--replace] <machine number> <chapter11.pdf>
//   node node_modules/.cache/manual-load.mjs [--dry-run] [--replace] --list jobs.tsv     (machine number <TAB> pdf path per line)
//   --no-balloons skips reading drawn balloon numbers off the pictures (scripts/balloons.ts), which is the slow part.
//
// A machine that already has parts lists is skipped unless --replace is given, so a catalog that
// staff or an earlier import built is never overwritten by accident. A machine the portal doesn't
// know is skipped too: the loader never makes machines.
import { appendFileSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { homedir } from "node:os";
import { createCanvas } from "@napi-rs/canvas";
import { closeReader, findBalloons } from "./balloons";
import { send } from "./cad-send";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { guessSection, linkSubAssemblies, readChapter11, type PageText, type TextItem } from "../src/shared/catalog/chapter11";

const PORTAL = process.env.RONCHI_PORTAL ?? "https://ronchi-portal.business-console.workers.dev";
const LOG = process.env.RONCHI_MANUAL_LOG ?? "C:\\ronchi-cad\\probe\\manual-load.tsv";
const args = process.argv.slice(2);
const dry = args.includes("--dry-run");
const replace = args.includes("--replace");
const readBalloons = !args.includes("--no-balloons");
const listAt = args.indexOf("--list");
const rest = args.filter((a, i) => !a.startsWith("--") && !(listAt >= 0 && i === listAt + 1));
const jobs: { serial: string; pdf: string }[] = listAt >= 0
  ? readFileSync(args[listAt + 1]!, "utf8").split(/\r?\n/).map((l) => l.split("\t")).filter((p) => p.length >= 2 && p[0]!.trim()).map((p) => ({ serial: p[0]!.trim(), pdf: p[1]!.trim() }))
  : rest.length === 2 ? [{ serial: rest[0]!, pdf: rest[1]! }] : [];
if (!jobs.length) { console.error("Give a machine number and its chapter 11 PDF, or --list jobs.tsv."); process.exit(2); }

const auth = { authorization: `Bearer ${readFileSync(join(homedir(), ".ronchi", "catalog-loader-key"), "utf8").trim()}` };
interface Machine { serial: string; sheets: { id: string; source?: string }[] }
// Asked again before every machine: a long list can run beside another one, and a machine that
// run has filled since this one started must be skipped, not loaded a second time.
const portalMachines = async () => {
  const machines = ((await (await send(`${PORTAL}/api/catalog-loader/machines`, { headers: auth })).json()) as { machines: Machine[] }).machines;
  return new Map(machines.map((m) => [m.serial.toUpperCase(), m]));
};

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

// Same as pageImage() there: sharp enough to zoom into the balloons, WebP.
async function pageImage(doc: pdfjs.PDFDocumentProxy, n: number, longSide = 3600) {
  const page = await doc.getPage(n);
  const vp1 = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: longSide / Math.max(vp1.width, vp1.height) });
  const canvas = createCanvas(Math.floor(vp.width), Math.floor(vp.height));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas: canvas as never, canvasContext: ctx as never, viewport: vp }).promise;
  page.cleanup();
  return { bytes: await canvas.encode("webp", 82), w: canvas.width, h: canvas.height, canvas, pointsWide: vp1.width };
}

const note = (serial: string, what: string, detail: Record<string, unknown> = {}) => {
  console.log(`${serial}: ${what}`, Object.keys(detail).length ? JSON.stringify(detail) : "");
  try { appendFileSync(LOG, [new Date().toISOString(), serial, what, JSON.stringify(detail)].join("\t") + "\n"); } catch { /* the log folder may not exist on another PC */ }
};

let done = 0, skipped = 0, failed = 0;
for (const job of jobs) {
  const serial = job.serial.toUpperCase();
  const m = (await portalMachines()).get(serial);
  if (!m) { skipped++; note(serial, "skipped: the portal has no machine with this number"); continue; }
  if (m.sheets.length && !replace) { skipped++; note(serial, `skipped: already has ${m.sheets.length} parts lists`); continue; }
  try {
    const t0 = Date.now();
    const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(job.pdf)), useSystemFonts: true }).promise;
    const pages: PageText[] = [];
    for (let n = 1; n <= doc.numPages; n++) pages.push(await pageText(doc, n));
    const { sheets } = readChapter11(pages);
    const rows = sheets.reduce((n, s) => n + s.rows.length, 0);
    if (!sheets.length) { failed++; note(serial, "nothing read: no parts tables with text (the PDF may be scanned pictures)", { pages: doc.numPages }); continue; }
    const parents = linkSubAssemblies(sheets);
    const warnings = sheets.flatMap((s) => s.warnings.map((x) => `Page ${s.page}: ${x}`));

    // One picture per drawing. Older manuals draw their balloon numbers instead of typing them,
    // so those are read off the picture here, before the parts lists are sent.
    const pictures = new Map<number, { bytes: Buffer; w: number; h: number }>();
    let drawn = 0, spots = 0, noSpot = 0;
    for (const s of sheets) {
      const img = await pageImage(doc, s.drawingPage ?? s.page);
      pictures.set(s.page, { bytes: img.bytes, w: img.w, h: img.h });
      if (!readBalloons || s.balloons.length || s.drawingPage === undefined || !s.rows.length) continue;
      const want = new Set(s.rows.map((r) => r.pos));
      const found = await findBalloons(img.canvas, img.pointsWide, want);
      if (process.env.RONCHI_BALLOON_LOG) console.log(`  p${s.drawingPage} ${s.code} rows ${want.size} spots ${new Set(found.balloons.map((b) => b.pos)).size} circles ${found.circles} turn ${found.turn}`);
      s.balloons = found.balloons;
      drawn++;
      const have = new Set(found.balloons.map((b) => b.pos));
      spots += have.size;
      noSpot += s.rows.filter((r) => !have.has(r.pos)).length;
      if (drawn % 20 === 0) console.log(`  ${serial}: balloons read on ${drawn} drawings`);
    }
    const balloonNote = drawn ? { drawingsWithDrawnBalloons: drawn, rowsWithSpot: spots, rowsWithoutSpot: noSpot } : {};
    if (dry) { done++; note(serial, "dry run", { pages: doc.numPages, sheets: sheets.length, rows, noNumber: sheets.filter((x) => !x.code).length, noDrawing: sheets.filter((x) => !x.balloons.length && x.drawingPage === undefined).length, warnings: warnings.length, ...balloonNote }); continue; }

    const res = await send(`${PORTAL}/api/catalog-loader/machines/${encodeURIComponent(serial)}/import`, {
      method: "POST", headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({
        fileName: basename(job.pdf), pages: doc.numPages, warnings,
        sheets: sheets.map((s) => ({
          key: String(s.page),
          parentKey: parents.has(s.page) ? String(parents.get(s.page)) : null,
          section: guessSection(s), grp: s.group, code: s.code, rev: s.rev,
          title: s.titleEn || s.titleIt || s.code || `Page ${s.page}`, titleIt: s.titleIt, page: s.page,
          rows: s.rows.map((row) => ({ ...row, hotspots: s.balloons.filter((b) => b.pos === row.pos).map(({ x, y, w, h }) => ({ x, y, w, h })) })),
        })),
      }),
    });
    if (!res.ok) { failed++; note(serial, `parts lists refused: ${res.status} ${(await res.text()).slice(0, 300)}`); continue; }
    const ids = ((await res.json()) as { sheets: { key: string; id: string }[] }).sheets;
    let drawings = 0, bytes = 0, bad = 0;
    for (const { key, id } of ids) {
      const img = pictures.get(Number(key))!;
      const put = await send(`${PORTAL}/api/catalog-loader/sheets/${id}/drawing?w=${img.w}&h=${img.h}`, { method: "PUT", headers: { ...auth, "content-type": "image/webp" }, body: img.bytes });
      if (put.ok) { drawings++; bytes += img.bytes.byteLength; } else bad++;
    }
    await doc.loadingTask.destroy();
    if (bad) failed++; else done++;
    note(serial, bad ? "loaded, but some drawings were refused" : "loaded", { ...balloonNote, sheets: ids.length, rows, drawings, drawingsRefused: bad, mb: +(bytes / 1048576).toFixed(1), warnings: warnings.length, seconds: Math.round((Date.now() - t0) / 1000) });
  } catch (e) {
    failed++;
    note(serial, `failed: ${(e as Error).message}`);
  }
}
await closeReader();
console.log(`\n${done} machines ${dry ? "read" : "loaded"}, ${skipped} skipped, ${failed} failed.`);
process.exit(failed ? 1 : 0);
