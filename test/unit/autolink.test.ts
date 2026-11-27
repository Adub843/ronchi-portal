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
