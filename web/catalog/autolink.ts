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
  boccola: ["bush", "bushing"], bussola: ["bush", "bushing"], vite: ["screw", "grub screw"], rondella: ["washer"], rosetta: ["washer"],
  perno: ["pin"], spina: ["pin"], albero: ["shaft"], molla: ["spring"], dado: ["nut"], staffa: ["bracket"], disco: ["disk", "disc"],
  anello: ["ring"], supporto: ["support"], coperchio: ["cover"], distanziale: ["spacer"], cuscinetto: ["bearing"],
  ghiera: ["ring nut"], km: ["ring nut"], madrevite: ["nut screw"], tappo: ["plug", "cap"], guarnizione: ["gasket", "seal"], leva: ["lever"], ruota: ["wheel"],
  cilindro: ["cylinder"], colonna: ["column"], guida: ["guide"], camma: ["cam"], pignone: ["pinion"], puleggia: ["pulley"],
  cinghia: ["belt"], carter: ["guard", "cover"], tubo: ["tube", "pipe"], raccordo: ["fitting"], blocchetto: ["block"],
  tirante: ["tie rod", "rod"], manopola: ["knob"], chiavetta: ["key", "tang", "tongue"], linguetta: ["key", "tang", "tongue"], grano: ["grub screw", "dowel"],
  ingranaggio: ["gear"], catena: ["chain"], stella: ["star", "starwheel"], coclea: ["screw", "scroll"], pinza: ["gripper", "clamp"],
  ugello: ["nozzle"], valvola: ["valve"], pistone: ["piston"], stelo: ["rod", "stem"], corpo: ["body"], testa: ["head"],
  mozzo: ["hub"], forcella: ["fork"], piolo: ["peg", "pin"], squadretta: ["bracket"], protezione: ["guard"], riparo: ["guard"],
  // From the 2026-11-27 triple check of every assembly.
  or: ["o ring"], uor: ["o ring"], oring: ["o ring"], maniglia: ["handle"], volantino: ["handwheel"], indicatore: ["indicator"],
  silenziatore: ["silencer"], portagomma: ["rubber holder"], semianello: ["half ring"], rotella: ["roller", "wheel"],
  sgancio: ["quick release"], paracolpo: ["bumper"], tubolare: ["tubular"], seeger: ["circlip"],
};
// What kind of part a row is, from its name ("NUT SCREW [MADREVITE]" is a nut screw, not a nut or a screw).
// A guess never puts a piece of one kind on a row of another.
const KINDS = ["nut screw", "ring nut", "self locking nut", "o ring", "grub screw", "quick release", "half ring", "screw", "washer", "nut",
  "flange", "tang", "tongue", "key", "bearing", "cylinder", "column", "spring", "pin", "shaft", "gasket", "seal", "handle", "handwheel",
  "indicator", "silencer", "belt", "pulley", "gear", "bumper", "circlip", "bush", "plate", "spacer", "shim"];
function kindOf(names: string[]): string | null {
  for (const n of names) { const t = ` ${n} `; for (const k of KINDS) if (t.includes(` ${k} `)) return k; }
  return null;
}
function kindsOf(names: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const n of names) for (const t of n.split(" ")) for (const en of WORDS[t] ?? WORDS[t.replace(/\d+$/, "")] ?? []) out.add(en);
  return out;
}

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
  // A size or catalogue number in both names: "or 4337" is "O-RING 4337", "skf 6011" is "BEARING SKF 6011", "8x7x40" is "TANG 8x7x40".
  if (unit.split(" ").some((t) => (/^\d{4,}$/.test(t) || /^\d+x\d+(x\d+)?$/.test(t)) && rowWords.includes(` ${t} `))) return true;
  // "lamiera1" is still a lamiera: the 3D loader drops the dot from "LAMIERA.1".
  return unit.split(" ").some((t) => (WORDS[t] ?? WORDS[t.replace(/\d+$/, "")])?.some((en) => rowWords.includes(` ${en} `)));
}

// Standard hardware: the same screw goes by its UNI, ISO or DIN number. A piece named with one
// standard is never linked to a row that names another, and goes to a row with its own first.
const NORMS: string[][] = [
  ["uni5931", "iso4762", "din912"], ["uni5933", "iso10642", "din7991"], ["uni5739", "iso4017", "din933"],
  ["uni5737", "iso4014", "din931"], ["uni5588", "iso4032", "din934"], ["uni6592", "iso7089", "iso7091", "din125"],
  ["uni1751", "din127"], ["uni5923", "iso4026", "din913"], ["uni5925", "iso4027", "din914"], ["uni5927", "iso4029", "din916"],
  ["uni7437", "din471"], ["uni7435", "din472"], ["uni6873", "iso8734", "din6325"], ["uni6604", "din6885"], ["iso7380"],
  ["uni7473", "iso7040", "din985"],
];
// Screw heads the lists name in words: a row saying COUNTERSUNK is a UNI 5933 screw, ROUND HEAD an ISO 7380, TCEI a UNI 5931.
const HEADS: [RegExp, string][] = [[/\b(countersunk|tspei|svasat\w*)\b/, "uni5933"], [/\b(round head|tbei|bombat\w*|button head)\b/, "iso7380"], [/\btcei\b/, "uni5931"], [/\bself locking nut\b/, "uni7473"]];
const NORM_OF = new Map(NORMS.flatMap((g) => g.map((n) => [n, g[0]!] as const)));
/** The standards baseName'd names cite, one name per standard ("uni en iso 4762" and "uni 5931" both give uni5931). */
function norms(names: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const s of names) {
    for (const m of s.matchAll(/\b(?:(uni en iso|en iso|iso|uni|din)\s?(\d{3,5})|u(\d{4}))/g)) {
      const n = m[3] ? `uni${m[3]}` : `${m[1]!.includes("iso") ? "iso" : m[1]}${m[2]}`;
      out.add(NORM_OF.get(n) ?? n);
    }
  }
  return out;
}
const meets = (a: Set<string>, b: Set<string>) => [...a].some((x) => b.has(x));

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
  const rowNorms = rowNames.map((n) => { const s = norms(n); for (const [re, k] of HEADS) if (n.some((x) => re.test(x))) s.add(k); return s; });
  const rowKind = rowNames.map((n) => kindOf(n));
  // A row naming another standard (or screw head) than the piece is never its row.
  const clash = (gn: Set<string>, i: number) => gn.size > 0 && rowNorms[i]!.size > 0 && !meets(gn, rowNorms[i]!);
  // Nor is a row of another kind of part: a nut is never on a RING NUT or NUT SCREW row, a flange never on a BEARING row.
  const otherKind = (gk: Set<string>, i: number) => gk.size > 0 && rowKind[i] !== null && !gk.has(rowKind[i]!);
  const cands = [...groups.values()].map((g) => {
    const gn = norms(g.names);
    const gk = kindsOf(g.names);
    const all = rows.map((_, i) => i).filter((i) => [...g.names].some((u) => rowNames[i]!.some((r) => named(u, r))));
    let cand = all.filter((i) => !clash(gn, i));
    // Prefer rows of the piece's own kind ("dado" names both NUT and RING NUT rows through "nut").
    const kin = cand.filter((i) => !otherKind(gk, i));
    if (kin.length) cand = kin;
    const same = cand.filter((i) => meets(gn, rowNorms[i]!));
    if (same.length) cand = same;
    // named: its name pointed at rows, so it is never left to the quantity guess below.
    return { g, gn, gk, rows: cand, named: all.length > 0 };
  });
  // Pieces whose name points at one row go first, so a row two pieces could claim is left for the right one.
  const order = cands.filter((c) => c.rows.length).sort((a, b) => a.rows.length - b.rows.length);
  for (const { g, rows: cand } of order) {
    const room = (i: number) => rows[i]!.qty === null || filled[i]! < rows[i]!.qty!;
    const pick = [...cand].sort((a, b) => Number(room(b)) - Number(room(a)) || Number(rows[b]!.qty === g.ids.length) - Number(rows[a]!.qty === g.ids.length) || a - b);
    let left = [...g.ids];
    for (const i of pick) {
      if (!left.length) break;
      if (!room(i)) continue;
      const take = rows[i]!.qty !== null && cand.length > 1 ? Math.min(left.length, rows[i]!.qty! - filled[i]!) : left.length;
      for (const id of left.slice(0, take)) out.set(id, { code: rows[i]!.code, sure: cand.length === 1 });
      filled[i]! += take;
      left = left.slice(take);
    }
    // More copies than the rows ask for: only a name that points at one row takes them. A guess never
    // piles pieces past a row's quantity (one row held 34 screws of 7 sizes before this).
    if (cand.length === 1) for (const id of left) out.set(id, { code: rows[cand[0]!]!.code, sure: true });
  }
  // What names couldn't settle: a piece that appears as many times as exactly one remaining row asks for.
  const restC = cands.filter((c) => !c.rows.length && !c.named);
  const restGroups = restC.map((c) => c.g);
  const restRows = rows.map((_, i) => i).filter((i) => !filled[i]);
  for (const g of restGroups) {
    const { gn, gk } = restC.find((c) => c.g === g)!;
    const same = restRows.filter((i) => !filled[i] && rows[i]!.qty === g.ids.length && !clash(gn, i) && !otherKind(gk, i));
    const rivals = restGroups.filter((x) => x.ids.length === g.ids.length && !out.has(x.ids[0]!));
    if (same.length === 1 && rivals.length === 1) {
      for (const id of g.ids) out.set(id, { code: rows[same[0]!]!.code, sure: false });
      filled[same[0]!]! += g.ids.length;
    }
  }
  const lastGroups = restGroups.filter((g) => !out.has(g.ids[0]!));
  const lastRows = restRows.filter((i) => !filled[i]);
  const lastC = lastGroups.length === 1 ? restC.find((c) => c.g === lastGroups[0])! : null;
  if (lastC && lastRows.length === 1 && !clash(lastC.gn, lastRows[0]!) && !otherKind(lastC.gk, lastRows[0]!)) for (const id of lastGroups[0]!.ids) out.set(id, { code: rows[lastRows[0]!]!.code, sure: false });
  return out;
}
