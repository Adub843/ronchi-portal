// Linking the pieces of a 3D model to the rows of a parts list when the CAD file doesn't name its
// parts by part number. Italy's STEP files often call them by what they are ("flangia",
// "SPESSORE", "LAMIERA.1") or by nothing useful ("p3", "g1"). Without a link a click on a piece
// can't find its row. Here each piece is matched to a row by its name (Italian or English, or the
// maker's part name) and, where names don't settle it, by how many times it appears against the
// row's quantity. Staff can still set any link by hand in the sheet's mesh map, which wins.
//
// Kept apart from the 3D viewer so it can be tested without three.js.

import { PART_WORDS as WORDS } from "./partwords";

/** One piece of the model: a part as the CAD file has it, with the names found on it. */
export interface Unit {
  id: string;
  names: string[];   // its own name and the names of its bodies
  sig: string;       // the same for copies of one part (same bodies, same size)
}
export interface PartRow {
  code: string;
  qty: number | null;
  names: (string | null | undefined)[];   // English and Italian names and the maker's part number
}
export interface Link { code: string; sure: boolean }

const EN = new Set(Object.values(WORDS).flat());
const itKey = (t: string): string | undefined => (WORDS[t] ? t : WORDS[t.replace(/\d+$/, "")] ? t.replace(/\d+$/, "") : undefined);
// "support for bearing" is a support: what follows these words describes something else.
const PREP = new Set(["for", "of", "with", "per", "di", "da", "con", "x"]);
// Names CAD programs give to solid bodies after their last feature ("Raccordo1" is a fillet, not a fitting).
const FEATURE = /^(?:taglio-|cut-|boss-)?(?:raccordo|smusso|estrusione|rivoluzione|foro|specchia|ripetizione|fillet|chamfer|extrude|revolve|mirror|pattern|solid|solido|body|corpo|part|parte|import\w*)\d+(?:_\d+)?$/i;

const clean = (s: string) => s.replace(/[^a-z0-9]+/g, " ").trim();
const lower = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** A name without accents, copy numbers or punctuation: "LAMIERA.1" and "Lamiera" both give "lamiera". */
export function baseName(name: string): string {
  return lower(name)
    // Copy numbers the CAD or the 3D loader adds ("-2", ".1", "_3"), and solid-body names ("_3Bdy2").
    .replace(/[._-]\d{1,3}$/, "").replace(/_?\d*bdy\d+$/, "").replace(/[._-]\d{1,3}$/, "")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

/** The same name from fullest to barest: "GERMK-14" gives "germk 14" then "germk", as "-14" may be a size or a copy number. */
function forms(name: string): string[] {
  const base = baseName(name);
  let s = lower(name);
  if (/bdy\d+/.test(s)) s = s.replace(/[._-]\d{1,3}$/, "").replace(/_?\d*bdy\d+$/, "");
  const out: string[] = [];
  for (let i = 0; i < 3; i++) {
    const c = clean(s);
    if (c.length >= base.length && !out.includes(c)) out.push(c);
    s = s.replace(/[._-]\d{1,3}$/, "");
  }
  if (base && !out.includes(base)) out.push(base);
  return out;
}

/** Names that say nothing about the part: "p3", "g1", "Part2", "Raccordo1". */
function blank(name: string): boolean {
  const b = baseName(name).replace(/ /g, "");
  return b.length < 4 || /^[a-z]?\d+$/.test(b) || FEATURE.test(name.trim());
}

/** What kind of thing a name says it is. Italian puts the thing first ("supporto anello" is a support),
 *  English puts it last ("ring support"), or first before a comma ("SCREW, SOCKET HEAD"). */
function kind(text: string): { key?: string; words: string[]; firm: boolean } | null {
  const t: string[] = [];
  for (const w of text.split(" ")) { if (PREP.has(w)) break; t.push(w); }
  // "anello OR 4262" and "guarnizione OR" are O-rings, not rings or gaskets.
  if (t.some((w) => w === "or" || w === "uor")) return { key: "or", words: WORDS.or!, firm: true };
  for (const w of t) { const k = itKey(w); if (k) return { key: k, words: WORDS[k]!, firm: true }; }
  const found: string[] = [];
  for (let i = t.length - 1; i >= 0; i--) {
    const two = i > 0 ? `${t[i - 1]} ${t[i]}` : "";
    if (two && EN.has(two)) { found.push(two); i--; } else if (EN.has(t[i]!)) found.push(t[i]!);
  }
  return found.length ? { words: [found[0]!], firm: new Set(found).size === 1 } : null;
}

const SPEC = (t: string) => t.length >= 2 && /\d/.test(t) && !itKey(t);

// Fastener standards. The CAD file names a screw by its ISO number, the parts list by the UNI number of the
// same thing ("VITE UNI EN ISO 4762 M8x30" is a "SCREW TCEI UNI 5931"). Each number maps to one name for the pair.
const STD: Record<string, string> = {
  "4762": "5931", "5931": "5931", "912": "5931",                                   // socket head cap screw (TCEI)
  "4017": "5739", "5739": "5739", "4014": "5739", "5737": "5739", "933": "5739", "931": "5739",   // hex head screw (TE)
  "10642": "5933", "5933": "5933", "7991": "5933",                                 // countersunk socket screw (TSEI)
  "7380": "7380", "1207": "1207",
  "4026": "5923", "4027": "5923", "4028": "5923", "4029": "5923", "5923": "5923", "5925": "5923", "5927": "5923", "5929": "5923",   // grub screws (STEI)
  "7089": "6592", "7090": "6592", "6592": "6592", "125": "6592",                   // flat washer
  "7093": "6593", "6593": "6593", "9021": "6593", "7091": "6593",                  // large or coarse flat washer
  "1751": "1751", "7980": "1751", "127": "1751", "1750": "1751",                   // spring (Grower) washer
  "4032": "5588", "5588": "5588", "934": "5588", "4033": "5588", "5587": "5588",   // hex nut
  "5721": "5721", "1587": "5721",                                                  // cap nut
  "7473": "7473", "7474": "7473", "10511": "7473", "7040": "7473", "985": "7473", "982": "7473",   // self-locking nut
};
const STD_KIND: Record<string, string> = { "5931": "screw", "5739": "screw", "5933": "screw", "7380": "screw", "1207": "screw", "5923": "screw", "6592": "washer", "6593": "washer", "1751": "washer", "5588": "nut", "5721": "nut", "7473": "nut" };
const STD_AT = /(?:^| )(?:uni|iso|din|u) ?(?:en )?(?:iso )?(\d{3,5})/;
/** The standard a cleaned name cites, as the one name its ISO, DIN and UNI numbers share. */
function standard(text: string): string | null {
  const m = STD_AT.exec(text);
  return m ? STD[m[1]!] ?? `#${m[1]}` : null;
}

/** How well a piece's name says it is this row's part: 4 its full name is in the row's, 3 its name less a
 *  trailing number is, 2 the same kind of thing, 1 the same kind but the row's name could be read two ways, 0 not. */
function score(raw: string, rowRaw: string): number {
  if (blank(raw)) return 0;
  const f = forms(raw);
  const base = f[f.length - 1]!;
  const row = clean(lower(rowRaw.split(",")[0]!));
  const rowAll = ` ${clean(lower(rowRaw))} `;
  if (!row) return 0;
  // Both cite a standard: the same one is this row (when any size the row gives agrees), another one is not.
  const mine = clean(lower(raw));
  const us = standard(mine), rs = standard(rowAll.trim());
  if (us && rs) {
    if (us !== rs) return 0;
    const sizes = rowAll.trim().replace(STD_AT, " ").replace(/^ ?\d\d(?= |$)/, " ").split(" ").filter((t) => /\d/.test(t));
    return sizes.every((t) => new RegExp(`(?:^|[ x])${t}(?:$|[ x])`).test(mine)) ? 3 : 0;
  }
  const uk = kind(base) ?? (us && STD_KIND[us] ? { words: [STD_KIND[us]!], firm: true } : null);
  const generic = !!uk && base.split(" ").every((t) => itKey(t) || EN.has(t) || PREP.has(t) || /^\d+$/.test(t));
  if (!generic) {
    for (const form of f) {
      const at = rowAll.indexOf(` ${form} `);
      if (at < 0) continue;
      if (form === f[0]) return 4;
      // "GERMK-12" is not the row "GERMK-14 ...": the number dropped from the name differs from the row's.
      const dropped = f[0]!.slice(form.length).trim().split(" ")[0]!;
      const next = rowAll.slice(at + form.length + 2).split(" ")[0]!;
      return /^\d+$/.test(next) && next !== dropped ? 0 : 3;
    }
  }
  const rk = kind(row);
  if (!uk || !rk || !uk.firm) return 0;
  const same = uk.key && uk.key === rk.key;
  if (!same && !uk.words.some((w) => rk.words.includes(w)) && !(uk.key && rk.key && WORDS[uk.key]!.some((w) => WORDS[rk.key!]!.includes(w)))) return 0;
  // "vite M8x30" is not the row "SCREW M8X20": sizes in the piece's name must be in the row's when it has any.
  const specs = f[0]!.split(" ").filter((t) => SPEC(t) && !(us && /^u?\d{3,5}[a-z]{0,2}$/.test(t)));
  if (specs.length && rowAll.trim().split(" ").some(SPEC) && !specs.every((s) => rowAll.includes(` ${s} `))) return 0;
  return same ? 2.5 : rk.firm ? 2 : 1;
}

/** Match pieces to rows. Returns piece id -> part code; sure is false where the name or the count leaves doubt. */
export function autoLink(units: Unit[], rows: PartRow[]): Map<string, Link> {
  const out = new Map<string, Link>();
  type Group = { ids: string[]; names: Set<string> };
  const groups = new Map<string, Group>();
  for (const u of units) {
    const g = groups.get(u.sig) ?? groups.set(u.sig, { ids: [], names: new Set() }).get(u.sig)!;
    g.ids.push(u.id);
    for (const n of u.names) if (n) g.names.add(n);
  }
  // A quantity that counts pieces: not null, and not 2.5 (metres of hose).
  const count = (i: number): number | null => { const q = rows[i]!.qty; return q !== null && Number.isInteger(q) && q > 0 ? q : null; };
  const filled = rows.map(() => 0);
  const claimed = rows.map(() => false);
  const put = (g: Group, ids: string[], i: number, sure: boolean) => { for (const id of ids) out.set(id, { code: rows[i]!.code, sure }); filled[i]! += ids.length; };

  const cands = [...groups.values()].map((g) => {
    const s = rows.map((r) => Math.max(0, ...[...g.names].flatMap((u) => r.names.map((n) => (n ? score(u, n) : 0)))));
    const top = Math.max(0, ...s);
    const idx = top ? rows.map((_, i) => i).filter((i) => s[i] === top) : [];
    for (const i of idx) claimed[i] = true;
    return { g, top, rows: idx };
  });

  // Pieces whose name points at one row go first, so a row two pieces could claim is left for the right one.
  for (let i = 0; i < rows.length; i++) {
    const sole = cands.filter((c) => c.rows.length === 1 && c.rows[0] === i);
    if (!sole.length) continue;
    const q = count(i);
    if (sole.length === 1) {
      const c = sole[0]!;
      // Sure only when the name is clear and the count agrees; ten washers against a row of two is a guess.
      put(c.g, c.g.ids, i, c.top >= 2 && (q === null || q === c.g.ids.length));
      continue;
    }
    // Several differently shaped pieces all say they are this row. At most the row's quantity can be.
    const total = sole.reduce((n, c) => n + c.g.ids.length, 0);
    const exact = sole.filter((c) => c.g.ids.length === q);
    if (q !== null && exact.length === 1 && total > q) put(exact[0]!.g, exact[0]!.g.ids, i, false);
    else if (q === null || total <= q) for (const c of sole) put(c.g, c.g.ids, i, false);
    // Otherwise nothing tells which of them it is: no link.
  }
  for (const { g, rows: cand } of cands.filter((c) => c.rows.length > 1)) {
    const room = (i: number) => count(i) === null || filled[i]! < count(i)!;
    const pick = cand.filter(room).sort((a, b) => Number(count(b) === g.ids.length) - Number(count(a) === g.ids.length) || a - b);
    let left = [...g.ids];
    for (const i of pick) {
      if (!left.length) break;
      const take = count(i) === null ? left.length : Math.min(left.length, count(i)! - filled[i]!);
      put(g, left.slice(0, take), i, false);
      left = left.slice(take);
    }
    // Pieces left over when every row they could be is full stay unlinked.
  }

  // What names couldn't settle: a piece with a name that says nothing, appearing as many times as exactly
  // one untouched row asks for, with no other unlinked piece appearing that many times.
  const restGroups = cands.filter((c) => !c.rows.length).map((c) => c.g);
  const isBlank = (g: Group) => [...g.names].every(blank);
  const free = (i: number) => !filled[i] && !claimed[i];
  for (const g of restGroups) {
    if (!isBlank(g)) continue;
    const same = rows.map((_, i) => i).filter((i) => free(i) && count(i) === g.ids.length);
    const rivals = restGroups.filter((x) => x.ids.length === g.ids.length && !out.has(x.ids[0]!));
    if (same.length === 1 && rivals.length === 1) put(g, g.ids, same[0]!, false);
  }
  // One piece and one row left over, and the row gives no quantity to check against.
  const lastGroups = [...groups.values()].filter((g) => !out.has(g.ids[0]!));
  const lastRows = rows.map((_, i) => i).filter(free);
  if (lastGroups.length === 1 && lastRows.length === 1 && isBlank(lastGroups[0]!) && rows[lastRows[0]!]!.qty === null && rows.length > 1)
    put(lastGroups[0]!, lastGroups[0]!.ids, lastRows[0]!, false);
  return out;
}
