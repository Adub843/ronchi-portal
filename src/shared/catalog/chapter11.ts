// Reads chapter 11 of a Ronchi manual ("Tavole costruttive / Construction tables") into sheets.
//
// The staff app opens the PDF in the browser (pdf.js), takes every piece of text with its
// position, and hands each page to readPage() below. Nothing here touches the network, so the
// same code runs in the browser and in the tests.
//
// A construction-table page has two parts:
//   - the exploded drawing, with balloon numbers (1, 2, 3 ...) pointing at parts
//   - the parts table: position, part code, revision, Italian name, English name, quantity
// We find the table rows by their part codes, read each row left to right, and then find the
// balloon numbers on the drawing (numbers outside the table that match a row's position).
// Those balloons become the clickable spots on the drawing.

import { isPartCode, type Hotspot, type ParsedSheet, type SheetRow } from "./model";

/** One piece of text from the PDF. x and y are the top-left corner, in PDF units, y going down. */
export interface TextItem {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PageText {
  page: number;
  width: number;
  height: number;
  items: TextItem[];
}

const REV = /^[A-Z]$/;
const INT = /^\d{1,3}$/;
const QTY = /^\d{1,4}(?:[.,]\d{1,3})?$/;
const UNIT = /^(?:m|mt|mm|kg|nr|n\.?|pz|pcs?)\.?$/i;

interface Token extends TextItem {
  cx: number;
  cy: number;
}

/** pdf.js sometimes gives a whole table line as one string; split it into words, keeping rough positions. */
function words(items: TextItem[]): Token[] {
  const out: Token[] = [];
  for (const it of items) {
    const parts = [...it.str.matchAll(/\S+/g)];
    if (!parts.length) continue;
    if (parts.length === 1 && parts[0]![0].length === it.str.length) {
      out.push({ ...it, cx: it.x + it.w / 2, cy: it.y + it.h / 2 });
      continue;
    }
    // Spread the width over the characters, so wide gaps between columns stay wide.
    const per = it.w / Math.max(it.str.length, 1);
    for (const m of parts) {
      const x = it.x + m.index! * per;
      const w = m[0].length * per;
      out.push({ str: m[0], x, y: it.y, w, h: it.h, cx: x + w / 2, cy: it.y + it.h / 2 });
    }
  }
  return out;
}

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

/** Group tokens into lines by their vertical centre. */
function lines(tokens: Token[]): Token[][] {
  const tol = Math.max(median(tokens.map((t) => t.h)) * 0.45, 1);
  const sorted = [...tokens].sort((a, b) => a.cy - b.cy || a.x - b.x);
  const out: Token[][] = [];
  for (const t of sorted) {
    const line = out[out.length - 1];
    if (line && Math.abs(line[0]!.cy - t.cy) <= tol) line.push(t);
    else out.push([t]);
  }
  return out.map((l) => l.sort((a, b) => a.x - b.x));
}

/** Split the name words of one row into Italian and English at the widest gap (the column edge). */
function splitNames(names: Token[], splitX: number | null): { it: string; en: string } {
  if (!names.length) return { it: "", en: "" };
  if (splitX !== null) {
    return {
      it: names.filter((t) => t.cx < splitX).map((t) => t.str).join(" "),
      en: names.filter((t) => t.cx >= splitX).map((t) => t.str).join(" "),
    };
  }
  let best = -1;
  let at = names.length;
  for (let i = 1; i < names.length; i++) {
    const gap = names[i]!.x - (names[i - 1]!.x + names[i - 1]!.w);
    if (gap > best) {
      best = gap;
      at = i;
    }
  }
  const avgChar = median(names.map((t) => t.w / Math.max(t.str.length, 1)));
  if (best < avgChar * 2.5) return { it: names.map((t) => t.str).join(" "), en: "" };
  return { it: names.slice(0, at).map((t) => t.str).join(" "), en: names.slice(at).map((t) => t.str).join(" ") };
}

/**
 * Where the English column starts. Tables have headers like "DESCRIZIONE" and "DESCRIPTION";
 * when they're there, the English header's left edge is the split. Otherwise, the most common
 * big gap across all rows.
 */
function englishColumnX(all: Token[]): number | null {
  const en = all.find((t) => /^DESCRIPTION$/i.test(t.str));
  const it = all.find((t) => /^DESCRIZIONE$/i.test(t.str));
  if (en && it && en.x > it.x) return en.x - 2;
  return null;
}

function toQty(s: string): number | null {
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Read one row: the tokens on the same line as a part code. */
function readRow(line: Token[], codeIndex: number, splitX: number | null): SheetRow & { tokens: Token[] } {
  const code = line[codeIndex]!;
  // Only what sits right next to the code belongs to the row; a balloon on the drawing can share the line.
  const reach = code.h * 8;
  const before = line.slice(0, codeIndex).filter((t) => code.x - (t.x + t.w) < reach);
  let after: Token[] = [];
  for (const t of line.slice(codeIndex + 1)) {
    const prev = after[after.length - 1] ?? code;
    if (t.x - (prev.x + prev.w) > reach * 3) break;
    after.push(t);
  }

  let rev: string | null = null;
  if (after[0] && REV.test(after[0].str)) {
    rev = after[0].str;
    after = after.slice(1);
  }

  // From the right: quantity, maybe a unit, maybe the position (when the table puts it last).
  let qty: number | null = null;
  let unit: string | null = null;
  let pos: string | null = null;
  const tail = [...after];
  const takeLast = () => tail.pop()!;
  const last = () => tail[tail.length - 1];

  // "... 24 3": quantity then the next column's position only if there's nothing left of the code.
  if (!before.some((t) => INT.test(t.str)) && tail.length >= 2 && INT.test(last()!.str) && QTY.test(tail[tail.length - 2]!.str)) {
    pos = takeLast().str;
  }
  if (last() && UNIT.test(last()!.str) && tail.length >= 2 && QTY.test(tail[tail.length - 2]!.str)) {
    unit = takeLast().str.replace(/\.$/, "").toLowerCase();
    if (unit === "mt") unit = "m";
    if (unit === "nr" || unit === "n" || unit === "pz" || unit === "pc" || unit === "pcs") unit = null;
  }
  if (last() && QTY.test(last()!.str)) qty = toQty(takeLast().str);
  if (last() && UNIT.test(last()!.str) && unit === null) {
    const u = takeLast().str.replace(/\.$/, "").toLowerCase();
    unit = u === "mt" ? "m" : u === "m" ? "m" : null;
  }

  if (pos === null) {
    const p = [...before].reverse().find((t) => INT.test(t.str));
    if (p) pos = p.str;
  }

  const names = splitNames(tail, splitX);
  return {
    pos: pos ?? "",
    code: code.str.toUpperCase(),
    rev,
    nameIt: names.it,
    nameEn: names.en,
    qty,
    unit,
    tokens: [...before, code, ...after],
  };
}

function box(tokens: Token[]) {
  return {
    x0: Math.min(...tokens.map((t) => t.x)),
    y0: Math.min(...tokens.map((t) => t.y)),
    x1: Math.max(...tokens.map((t) => t.x + t.w)),
    y1: Math.max(...tokens.map((t) => t.y + t.h)),
  };
}

const GROUP_HEAD = /^(?:\d{1,2}\.\d{1,2}\s+)?GRUPP[IO]\b/i;

// ---------- Older manuals: the table on its own page ----------
//
// Manuals up to about machine 4000 print each assembly as two pages: a table page, then the
// drawing page. The table has a header line
//     ITEM  CODE  REV.  DESCRIZIONE  DESCRIPTION  SPEC.  QTY
// with the assembly's own number and names on the line above it ("GS089663/A  RIEMPITRICE
// FILLING MACHINE"). Every cell is its own piece of text, so the columns are read by where the
// header words sit. The drawing page has no text at all: its balloon numbers are drawn as lines,
// so this reader can't place balloons (the PC loader finds them by reading the picture).

const HEAD_WORDS = { item: /^ITEM$/i, code: /^CODE$/i, rev: /^REV\.?$/i, it: /^DESCRIZIONE$/i, en: /^DESCRIPTION$/i, spec: /^SPEC\.?$/i, qty: /^Q\.?TY\.?$/i };
const OWN_CODE = /^(.+?)(?:\/([A-Z0-9]{1,2}))?$/;

const listSheets = new WeakSet<ParsedSheet>();

function readListPage(page: PageText): ParsedSheet | null {
  const items = page.items.filter((t) => t.str.trim());
  const find = (re: RegExp, near?: number) => items.find((t) => re.test(t.str.trim()) && (near === undefined || Math.abs(t.y - near) < 6));
  const item = find(HEAD_WORDS.item);
  if (!item) return null;
  const col = { item, code: find(HEAD_WORDS.code, item.y), it: find(HEAD_WORDS.it, item.y), en: find(HEAD_WORDS.en, item.y), qty: find(HEAD_WORDS.qty, item.y), rev: find(HEAD_WORDS.rev, item.y), spec: find(HEAD_WORDS.spec, item.y) };
  if (!col.code || !col.it || !col.en || !col.qty) return null;
  const x = { code: col.code.x - 4, rev: (col.rev?.x ?? col.it.x) - 6, it: col.it.x - 4, en: col.en.x - 4, spec: (col.spec?.x ?? col.qty.x - 60) - 4, qty: col.qty.x - 14 };
  const text = (list: TextItem[]) => [...list].sort((a, b) => a.y - b.y || a.x - b.x).map((t) => t.str.trim()).join(" ").replace(/\s+/g, " ");
  const warnings: string[] = [];
  const sheet: ParsedSheet = { page: page.page, code: null, rev: null, titleIt: "", titleEn: "", group: null, rows: [], balloons: [], warnings };

  // The assembly's own line: just above the header, never the page header (machine number, chapter).
  const lineH = Math.max(item.h, 6);
  const own = items.filter((t) => t.y < item.y - lineH * 0.5 && t.y > item.y - lineH * 3.2);
  for (const t of own.filter((o) => o.x < x.it)) {
    const m = OWN_CODE.exec(t.str.trim().toUpperCase().replace(/\s+/g, ""));
    if (m && isPartCode(m[1]!)) {
      sheet.code = m[1]!;
      sheet.rev = m[2] ?? null;
      break;
    }
  }
  sheet.titleIt = text(own.filter((t) => t.x >= x.it && t.x < x.en));
  sheet.titleEn = text(own.filter((t) => t.x >= x.en));

  // Rows: every position number under ITEM starts a row; other cells join the nearest one.
  const below = items.filter((t) => t.y > item.y + lineH * 0.5 && t.y < page.height * 0.94);
  const anchors = below.filter((t) => t.x < x.code && INT.test(t.str.trim())).sort((a, b) => a.y - b.y);
  if (!anchors.length) return sheet.code ? sheet : null;
  const mid = (t: TextItem) => t.y + t.h / 2;
  const cells = anchors.map(() => [] as TextItem[]);
  for (const t of below) {
    if (t.x < x.code) continue;
    let best = 0;
    for (let i = 1; i < anchors.length; i++) if (Math.abs(mid(anchors[i]!) - mid(t)) < Math.abs(mid(anchors[best]!) - mid(t))) best = i;
    if (Math.abs(mid(anchors[best]!) - mid(t)) < lineH * 2.5) cells[best]!.push(t);
  }
  const seen = new Set<string>();
  anchors.forEach((a, i) => {
    const c = cells[i]!;
    const pos = a.str.trim();
    const raw = text(c.filter((t) => t.x >= x.code && t.x < x.rev)).toUpperCase().replace(/\s+/g, "");
    if (!isPartCode(raw)) {
      if (raw) warnings.push(`Position ${pos}: "${raw.slice(0, 30)}" is not a Ronchi part number, left out.`);
      return;
    }
    if (seen.has(`${pos}|${raw}`)) return;
    seen.add(`${pos}|${raw}`);
    const rev = text(c.filter((t) => t.x >= x.rev && t.x < x.it));
    const qtyText = text(c.filter((t) => t.x >= x.qty)).replace(",", ".");
    const qm = /^(\d{1,4}(?:\.\d{1,3})?)\s*([A-Za-z.]*)$/.exec(qtyText);
    const qty = qm ? Number(qm[1]) : null;
    if (qty === null) warnings.push(`Row ${raw} has no quantity.`);
    sheet.rows.push({
      pos, code: raw, rev: REV.test(rev) ? rev : null,
      nameIt: text(c.filter((t) => t.x >= x.it && t.x < x.en)),
      nameEn: text(c.filter((t) => t.x >= x.en && t.x < x.spec)),
      qty, unit: qm && /^m(?:t|\.)?$/i.test(qm[2] ?? "") ? "m" : null,
    });
  });
  if (!sheet.code) warnings.push("The sheet's own part code was not found.");
  listSheets.add(sheet);
  return sheet;
}

/** Read one page of chapter 11. Pages without a parts table come back with no rows. */
export function readPage(page: PageText): ParsedSheet {
  const listed = readListPage(page);
  if (listed) return listed;
  const tokens = words(page.items);
  const warnings: string[] = [];
  const sheet: ParsedSheet = { page: page.page, code: null, rev: null, titleIt: "", titleEn: "", group: null, rows: [], balloons: [], warnings };
  if (!tokens.length) return sheet;

  const splitX = englishColumnX(tokens);
  const allLines = lines(tokens);

  // Rows: lines with a part code that also carry a quantity or a position.
  const rows: (SheetRow & { tokens: Token[] })[] = [];
  const rowLines = new Set<Token[]>();
  for (const line of allLines) {
    const ci = line.findIndex((t) => isPartCode(t.str));
    if (ci < 0) continue;
    const row = readRow(line, ci, splitX);
    if (row.qty === null && !row.pos) continue; // a code in the title block, not a table row
    rows.push(row);
    rowLines.add(line);
  }

  // The table's area: every row token plus its header line.
  const tableTokens = rows.flatMap((r) => r.tokens);
  const table = tableTokens.length ? box(tableTokens) : null;
  if (table) {
    const pad = median(tableTokens.map((t) => t.h)) * 1.5;
    table.y0 -= pad * 2; // header line above the first row
    table.y1 += pad;
  }

  // The sheet's own assembly: a part code that is not in the table (the title block).
  for (const line of allLines) {
    if (rowLines.has(line)) continue;
    const ci = line.findIndex((t) => isPartCode(t.str));
    if (ci < 0) continue;
    const rest = line.slice(ci + 1);
    let rev: string | null = null;
    if (rest[0] && REV.test(rest[0].str)) {
      rev = rest[0].str;
      rest.shift();
    }
    // The title block sits away from the table, so the table's column line doesn't apply there:
    // split the Italian and English names at the widest gap instead.
    const names = splitNames(rest.filter((t) => !/^\d+\/\d+$/.test(t.str)), null);
    sheet.code = line[ci]!.str.toUpperCase();
    sheet.rev = rev;
    sheet.titleIt = names.it;
    sheet.titleEn = names.en;
    break;
  }

  // Group heading, for example "11.2 GRUPPI TAPPATORE".
  for (const line of allLines) {
    const text = line.map((t) => t.str).join(" ");
    if (GROUP_HEAD.test(text)) {
      sheet.group = text.replace(/^\d{1,2}\.\d{1,2}\s+/, "").trim();
      break;
    }
  }

  // De-duplicate rows (some tables repeat the header area on wide pages) and keep table order.
  const seen = new Set<string>();
  for (const r of rows) {
    const key = `${r.pos}|${r.code}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const { tokens: _t, ...clean } = r;
    sheet.rows.push(clean);
    if (!r.pos) warnings.push(`Row ${r.code} has no position number.`);
    if (r.qty === null) warnings.push(`Row ${r.code} has no quantity.`);
  }

  // Balloons: small whole numbers on the drawing (outside the table) that match a row position.
  const positions = new Set(sheet.rows.map((r) => r.pos).filter(Boolean));
  const inTable = (t: Token) => table !== null && t.cx >= table.x0 && t.cx <= table.x1 && t.cy >= table.y0 && t.cy <= table.y1;
  for (const t of tokens) {
    if (!INT.test(t.str) || !positions.has(t.str) || inTable(t)) continue;
    // Page numbers like "5/254" are split off already; skip anything in the bottom 3% (footer).
    if (t.cy > page.height * 0.97) continue;
    const size = Math.max(t.h, t.w) * 1.9; // the circle around the number
    const spot: Hotspot = {
      x: clamp((t.cx - size / 2) / page.width),
      y: clamp((t.cy - size / 2) / page.height),
      w: size / page.width,
      h: size / page.height,
    };
    sheet.balloons.push({ pos: t.str, ...spot });
  }
  for (const p of positions) {
    if (!sheet.balloons.some((b) => b.pos === p)) warnings.push(`Position ${p} was not found on the drawing.`);
  }
  if (sheet.rows.length && !sheet.code) warnings.push("The sheet's own part code was not found.");
  return sheet;
}

function clamp(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/** Read every page; keep the pages that have a parts table. */
export function readChapter11(pages: PageText[]): { sheets: ParsedSheet[]; skipped: number[] } {
  const sheets: ParsedSheet[] = [];
  const skipped: number[] = [];
  let group: string | null = null;
  const tablePages = new Map<ParsedSheet, number>();   // each sheet's last table page
  for (const p of pages) {
    const s = readPage(p);
    if (s.group) group = s.group;
    if (!s.rows.length) {
      skipped.push(p.page);
      continue;
    }
    s.group ??= group;
    // A table that runs over two pages: the same assembly again on the next page joins the first.
    const last = sheets[sheets.length - 1];
    if (last && s.code && last.code === s.code && last.page === p.page - 1 && listSheets.has(last) && listSheets.has(s)) {
      const have = new Set(last.rows.map((r) => `${r.pos}|${r.code}`));
      last.rows.push(...s.rows.filter((r) => !have.has(`${r.pos}|${r.code}`)));
      last.warnings.push(...s.warnings);
      tablePages.set(last, p.page);
      continue;
    }
    sheets.push(s);
    tablePages.set(s, p.page);
  }
  // Older manuals: a table page with no balloons, followed by a page with no table, is drawn from that next page.
  const byPage = new Map(pages.map((p) => [p.page, p]));
  const rowPages = new Set(sheets.map((s) => s.page));
  for (const s of sheets) {
    if (s.balloons.length || !listSheets.has(s)) continue;
    const next = byPage.get(tablePages.get(s)! + 1);
    if (next && !rowPages.has(next.page) && skipped.includes(next.page) && next.items.length <= 12) s.drawingPage = next.page;
  }
  return { sheets, skipped };
}

/**
 * Which sheet is inside which: a row whose code is another sheet's own code is that sub-assembly.
 * Returns child page -> parent page. The first sheet that lists a code wins.
 */
export function linkSubAssemblies(sheets: ParsedSheet[]): Map<number, number> {
  const byCode = new Map<string, number>();
  for (const s of sheets) if (s.code && !byCode.has(s.code)) byCode.set(s.code, s.page);
  const parent = new Map<number, number>();
  for (const s of sheets) {
    for (const r of s.rows) {
      const child = byCode.get(r.code);
      if (child !== undefined && child !== s.page && !parent.has(child)) parent.set(child, s.page);
    }
  }
  return parent;
}

/** Which part of the catalogue a sheet belongs in, from its group and names. */
export function guessSection(s: ParsedSheet): "machine" | "format" | "elevator" {
  const text = `${s.group ?? ""} ${s.titleEn} ${s.titleIt}`.toLowerCase();
  if (/format|change ?part|cambio/.test(text)) return "format";
  if (/elevat|elevator/.test(text)) return "elevator";
  return "machine";
}
