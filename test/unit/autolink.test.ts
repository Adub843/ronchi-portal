import { describe, expect, it } from "vitest";
import { autoLink, baseName, type PartRow, type Unit } from "../../web/catalog/autolink";

// The pieces of GF063579 (anti-rotation) as Italy's STEP file names them, and its parts list.
const units: Unit[] = [
  { id: "p3a", names: ["p3", "p3"], sig: "p3|120" },
  { id: "p3b", names: ["p3", "p3"], sig: "p3|120" },
  { id: "germk", names: ["GERMK-14", "GERMK_14_3Bdy2", "GERMK_14_3Bdy3", "GERMK_14_3Bdy1"], sig: "germk 14|900" },
  { id: "g1", names: ["g1", "GERMK_14_3Bdy2", "GERMK_14_3Bdy3", "GERMK_14_3Bdy1"], sig: "germk 14|900" },
  { id: "sp1", names: ["SPESSORE", "SPESSORE"], sig: "spessore|40" },
  { id: "sp2", names: ["SPESSORE", "SPESSORE"], sig: "spessore|40" },
  { id: "p3c", names: ["p3", "p3"], sig: "p3|120" },
  { id: "lam1", names: ["LAMIERA.1", "LAMIERA.1"], sig: "lamiera|60" },
  { id: "fl", names: ["flangia", "flangia"], sig: "flangia|300" },
  { id: "lam", names: ["LAMIERA", "LAMIERA"], sig: "lamiera|64" },
  { id: "p3d", names: ["p3", "p3"], sig: "p3|120" },
];
const rows: PartRow[] = [
  { code: "CM006027", qty: 4, names: ["BUSH", null] },
  { code: "CD062019", qty: 1, names: ["PLATE", null] },
  { code: "CD063658", qty: 1, names: ["FLANGE", null] },
  { code: "CD062020", qty: 1, names: ["PLATE", null] },
  { code: "CD062018", qty: 2, names: ["SHIM", null] },
  { code: "CM006026_1", qty: 2, names: ["GERMK-14 IGUS FORK", null] },
];

describe("linking 3D pieces to parts list rows", () => {
  it("strips copy numbers and punctuation from names", () => {
    expect(baseName("LAMIERA.1")).toBe("lamiera");
    expect(baseName("GERMK_14_3Bdy2")).toBe("germk");
    expect(baseName("Flàngia-2")).toBe("flangia");
    // The 3D loader makes names unique by adding _1, _2 ...
    expect(baseName("GERMK_14_3Bdy2_1")).toBe("germk");
  });

  it("links every piece of the anti-rotation assembly to its row", () => {
    const got = autoLink(units, rows);
    const code = (id: string) => got.get(id)?.code;
    expect(code("fl")).toBe("CD063658");
    expect([code("sp1"), code("sp2")]).toEqual(["CD062018", "CD062018"]);
    expect([code("germk"), code("g1")]).toEqual(["CM006026_1", "CM006026_1"]);
    // Two plates, two rows called PLATE: one each, flagged as not certain.
    expect(new Set([code("lam"), code("lam1")])).toEqual(new Set(["CD062019", "CD062020"]));
    expect(got.get("lam")!.sure).toBe(false);
    // "p3" says nothing, but four of them and one row left asking for four.
    expect(["p3a", "p3b", "p3c", "p3d"].map(code)).toEqual(["CM006027", "CM006027", "CM006027", "CM006027"]);
    expect(got.get("p3a")!.sure).toBe(false);
    expect(got.get("fl")!.sure).toBe(true);
  });

  it("uses the Italian name when the list has one", () => {
    const got = autoLink([{ id: "a", names: ["Boccola"], sig: "a" }, { id: "b", names: ["x9"], sig: "b" }, { id: "c", names: ["y9"], sig: "c" }],
      [{ code: "CD000001", qty: 1, names: ["BUSHING", "BOCCOLA"] }, { code: "CD000002", qty: 1, names: ["PIN", "PERNO"] }, { code: "CD000003", qty: 1, names: ["KEY", "CHIAVETTA"] }]);
    expect(got.get("a")).toEqual({ code: "CD000001", sure: true });
    // Two unnamed pieces and two rows with the same quantity: nothing to tell them apart, so no guess.
    expect(got.has("b")).toBe(false);
    expect(got.has("c")).toBe(false);
  });

  it("still reads a name the 3D loader changed", () => {
    const got = autoLink([{ id: "a", names: ["LAMIERA1", "LAMIERA1"], sig: "a" }], [{ code: "CD000001", qty: 1, names: ["PLATE"] }, { code: "CD000002", qty: 3, names: ["SCREW"] }]);
    expect(got.get("a")).toEqual({ code: "CD000001", sure: true });
  });

  it("links nothing when nothing fits", () => {
    expect(autoLink([{ id: "a", names: ["solid1"], sig: "a" }, { id: "b", names: ["solid2"], sig: "b" }], [{ code: "CD000001", qty: 5, names: ["SCREW"] }, { code: "CD000002", qty: 7, names: ["NUT"] }]).size).toBe(0);
  });
});

describe("standard hardware", () => {
  it("never links a screw to a row of another standard, and prefers the row with the same standard", () => {
    const u: Unit[] = [
      { id: "a", names: ["VITE_UNI5931_M6x25"], sig: "a|1" },
      { id: "b", names: ["VITE_UNI_5933_M6x16"], sig: "b|1" },
      { id: "c", names: ["VITE_UNI_EN_ISO_4762TF_M8x125x20"], sig: "c|1" },
    ];
    const r: PartRow[] = [
      { code: "X5739", qty: 1, names: ["SCREW TE UNI 5739", null] },
      { code: "X5933", qty: 1, names: ["SCREW TSPEI UNI 5933", null] },
      { code: "X5931", qty: 2, names: ["SCREW TCEI UNI 5931", null] },
    ];
    const got = autoLink(u, r);
    expect(got.get("a")?.code).toBe("X5931");
    expect(got.get("b")?.code).toBe("X5933");
    expect(got.get("c")?.code).toBe("X5931");   // UNI EN ISO 4762 is the same screw as UNI 5931
  });
  it("leaves a screw unlinked when the only screw rows are of another standard", () => {
    const got = autoLink([{ id: "a", names: ["VITE_UNI5931_M6x25"], sig: "a|1" }], [{ code: "X5739", qty: 1, names: ["SCREW TE UNI 5739", null] }]);
    expect(got.has("a")).toBe(false);
  });
});

describe("rules from the triple check (2026-11-27)", () => {
  const link = (names: string[], rows: PartRow[]) => autoLink([{ id: "a", names, sig: "a|1" }], rows).get("a")?.code ?? null;
  it("never guesses a piece onto a row of another kind", () => {
    expect(link(["sgancio_x32"], [{ code: "S", qty: 1, names: ["SCREW", null] }])).toBeNull();
    expect(link(["dado_m20"], [{ code: "MV", qty: 1, names: ["NUT SCREW [MADREVITE]", null] }, { code: "N", qty: 1, names: ["NUT", null] }])).toBe("N");
    expect(link(["ghiera_km6"], [{ code: "N", qty: 1, names: ["NUT", null] }, { code: "RN", qty: 1, names: ["RING NUT", null] }])).toBe("RN");
    expect(link(["dado_m8"], [{ code: "RN", qty: 1, names: ["RING NUT", null] }, { code: "N", qty: 1, names: ["NUT", null] }])).toBe("N");
    expect(link(["flangia"], [{ code: "B", qty: 1, names: ["BEARING", null] }])).toBeNull();
  });
  it("puts each screw on the row of its head type", () => {
    const rows: PartRow[] = [
      { code: "CS", qty: 1, names: ["COUNTERSUNK HEX HEAD SCREW", null] },
      { code: "RH", qty: 1, names: ["ROUND HEAD SCREW", null] },
      { code: "S", qty: 1, names: ["SCREW", null] },
    ];
    const got = autoLink([
      { id: "tspei", names: ["VITE_UNI_5933_M6x16"], sig: "1|1" },
      { id: "tcei", names: ["VITE_UNI_EN_ISO_4762_M6x20"], sig: "2|1" },
      { id: "tbei", names: ["VITE_ISO_7380_M5x10"], sig: "3|1" },
    ], rows);
    expect(got.get("tspei")?.code).toBe("CS");
    expect(got.get("tcei")?.code).toBe("S");
    expect(got.get("tbei")?.code).toBe("RH");
  });
  it("reads O-rings, keys, bearings and sizes in the piece name", () => {
    const rows: PartRow[] = [
      { code: "OR1", qty: 1, names: ["O-RING 4337", null] }, { code: "OR2", qty: 1, names: ["O-RING 3131", null] },
      { code: "K", qty: 1, names: ["TANG 8x7x40", null] }, { code: "B1", qty: 1, names: ["BEARING SKF 6011", null] },
    ];
    const got = autoLink([
      { id: "o", names: ["or_4337"], sig: "o|1" }, { id: "o2", names: ["OR-3131"], sig: "o2|1" },
      { id: "k", names: ["linguetta 8x7x40"], sig: "k|1" }, { id: "b", names: ["SKF_6011"], sig: "b|1" },
    ], rows);
    expect(got.get("o")?.code).toBe("OR1");
    expect(got.get("o2")?.code).toBe("OR2");
    expect(got.get("k")?.code).toBe("K");
    expect(got.get("b")?.code).toBe("B1");
  });
});
