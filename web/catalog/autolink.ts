// Linking the pieces of a 3D model to the rows of a parts list when the CAD file doesn't name its
// parts by part number. Italy's STEP files often call them by what they are ("flangia",
// "SPESSORE", "LAMIERA.1") or by nothing useful ("p3", "g1"). Without a link a click on a piece
// can't find its row. Here each piece is matched to a row by its name (Italian or English, or the
// maker's part name) and, where names don't settle it, by how many times it appears against the
// row's quantity. Staff can still set any link by hand in the sheet's mesh map, which wins.
//
// Kept apart from the 3D viewer so it can be tested without three.js.

/** One piece of the model: a part as the CAD file has it, with the names found on it. */
export interface Unit {
  id: string;
  names: string[];   // its own name and the names of its bodies
  sig: string;       // the same for copies of one part (same bodies, same size)
}
export interface PartRow {
  code: string;
  qty: number | null;
  names: (string | null | undefined)[];   // English and Italian names, maker and maker's part number
}
export interface Link { code: string; sure: boolean }

// The Italian words Ronchi's CAD files use for common parts, with the English the lists use.
const WORDS: Record<string, string[]> = {
  flangia: ["flange"], spessore: ["shim", "spacer"], lamiera: ["plate", "sheet"], piastra: ["plate"], piatto: ["plate"],
  boccola: ["bush", "bushing"], bussola: ["bush", "bushing"], vite: ["screw"], rondella: ["washer"], rosetta: ["washer"],
  perno: ["pin"], spina: ["pin"], albero: ["shaft"], molla: ["spring"], dado: ["nut"], staffa: ["bracket"], disco: ["disk", "disc"],
  anello: ["ring"], supporto: ["support"], coperchio: ["cover"], distanziale: ["spacer"], cuscinetto: ["bearing"],
  ghiera: ["ring nut", "nut"], tappo: ["plug", "cap"], guarnizione: ["gasket", "seal"], leva: ["lever"], ruota: ["wheel"],
  cilindro: ["cylinder"], colonna: ["column"], guida: ["guide"], camma: ["cam"], pignone: ["pinion"], puleggia: ["pulley"],
  cinghia: ["belt"], carter: ["guard", "cover"], tubo: ["tube", "pipe"], raccordo: ["fitting"], blocchetto: ["block"],
  tirante: ["tie rod", "rod"], manopola: ["knob"], chiavetta: ["key"], linguetta: ["key"], grano: ["grub screw", "dowel"],
  ingranaggio: ["gear"], catena: ["chain"], stella: ["star", "starwheel"], coclea: ["screw", "scroll"], pinza: ["gripper", "clamp"],
  ugello: ["nozzle"], valvola: ["valve"], pistone: ["piston"], stelo: ["rod", "stem"], corpo: ["body"], testa: ["head"],
  mozzo: ["hub"], forcella: ["fork"], piolo: ["peg", "pin"], squadretta: ["bracket"], protezione: ["guard"], riparo: ["guard"],
};

/** A name without accents, copy numbers or punctuation: "LAMIERA.1" and "Lamiera" both give "lamiera". */
export function baseName(name: string): string {
  return name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    // Copy numbers the CAD or the 3D loader adds ("-2", ".1", "_3"), and solid-body names ("_3Bdy2").
    .replace(/[._-]\d{1,3}$/, "").replace(/_?\d*bdy\d+$/, "").replace(/[._-]\d{1,3}$/, "")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

/** Whether a piece's name says it is this row's part. Names too short to mean anything ("p3", "g1") never do. */
function named(unit: string, row: string): boolean {
  if (unit.replace(/ /g, "").length < 4 || /^[a-z]?\d+$/.test(unit.replace(/ /g, ""))) return false;
  if (!row) return false;
  if (unit === row) return true;
  const rowWords = ` ${row} `;
  if (rowWords.includes(` ${unit} `)) return true;   // "germk 14" in "germk 14 igus fork"
  // "lamiera1" is still a lamiera: the 3D loader drops the dot from "LAMIERA.1".
  return unit.split(" ").some((t) => (WORDS[t] ?? WORDS[t.replace(/\d+$/, "")])?.some((en) => rowWords.includes(` ${en} `)));
}

/** Match pieces to rows. Returns piece id -> part code; sure is false where it was settled by order or quantity alone. */
export function autoLink(units: Unit[], rows: PartRow[]): Map<string, Link> {
  const out = new Map<string, Link>();
  const groups = new Map<string, { ids: string[]; names: Set<string> }>();
  for (const u of units) {
    const g = groups.get(u.sig) ?? groups.set(u.sig, { ids: [], names: new Set() }).get(u.sig)!;
    g.ids.push(u.id);
    for (const n of u.names) { const b = baseName(n); if (b) g.names.add(b); }
  }
  const rowNames = rows.map((r) => r.names.map((n) => (n ? baseName(n) : "")).filter(Boolean));
  const filled = rows.map(() => 0);
  const cands = [...groups.values()].map((g) => ({
    g, rows: rows.map((_, i) => i).filter((i) => [...g.names].some((u) => rowNames[i]!.some((r) => named(u, r)))),
  }));
  // Pieces whose name points at one row go first, so a row two pieces could claim is left for the right one.
  const order = cands.filter((c) => c.rows.length).sort((a, b) => a.rows.length - b.rows.length);
  for (const { g, rows: cand } of order) {
    const room = (i: number) => rows[i]!.qty === null || filled[i]! < rows[i]!.qty!;
    const pick = [...cand].sort((a, b) => Number(room(b)) - Number(room(a)) || Number(rows[b]!.qty === g.ids.length) - Number(rows[a]!.qty === g.ids.length) || a - b);
    let left = [...g.ids];
    for (const i of pick) {
      if (!left.length) break;
      if (!room(i) && i !== pick[pick.length - 1]) continue;
      const take = room(i) && rows[i]!.qty !== null && cand.length > 1 ? Math.min(left.length, rows[i]!.qty! - filled[i]!) : left.length;
      for (const id of left.slice(0, take)) out.set(id, { code: rows[i]!.code, sure: cand.length === 1 });
      filled[i]! += take;
      left = left.slice(take);
    }
    for (const id of left) out.set(id, { code: rows[pick[0]!]!.code, sure: false });
  }
  // What names couldn't settle: a piece that appears as many times as exactly one remaining row asks for.
  const restGroups = cands.filter((c) => !c.rows.length).map((c) => c.g);
  const restRows = rows.map((_, i) => i).filter((i) => !filled[i]);
  for (const g of restGroups) {
    const same = restRows.filter((i) => !filled[i] && rows[i]!.qty === g.ids.length);
    const rivals = restGroups.filter((x) => x.ids.length === g.ids.length && !out.has(x.ids[0]!));
    if (same.length === 1 && rivals.length === 1) {
      for (const id of g.ids) out.set(id, { code: rows[same[0]!]!.code, sure: false });
      filled[same[0]!]! += g.ids.length;
    }
  }
  const lastGroups = restGroups.filter((g) => !out.has(g.ids[0]!));
  const lastRows = restRows.filter((i) => !filled[i]);
  if (lastGroups.length === 1 && lastRows.length === 1) for (const id of lastGroups[0]!.ids) out.set(id, { code: rows[lastRows[0]!]!.code, sure: false });
  return out;
}
