import { describe, expect, it } from "vitest";
import { autoLink, baseName, spread, type PartRow, type Unit } from "../../web/catalog/autolink";
import { listCodeOf } from "../../web/catalog/codes";

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

  it("does not let the infeed scroll or a ring nut claim the fastener rows", () => {
    const got = autoLink(
      [{ id: "sc", names: ["COCLEA"], sig: "sc" }, { id: "gh", names: ["GHIERA"], sig: "gh" }, { id: "v", names: ["VITE"], sig: "v" }, { id: "d", names: ["DADO"], sig: "d" }],
      [{ code: "CD000001", qty: 1, names: ["SCREW"] }, { code: "CD000002", qty: 1, names: ["NUT"] }, { code: "CD000003", qty: 1, names: ["SCROLL"] }, { code: "CD000004", qty: 1, names: ["RING NUT"] }]);
    expect(got.get("sc")).toEqual({ code: "CD000003", sure: true });
    expect(got.get("gh")).toEqual({ code: "CD000004", sure: true });
    expect(got.get("v")).toEqual({ code: "CD000001", sure: true });
    expect(got.get("d")!.code).toBe("CD000002");
  });

  it("reads plurals", () => {
    const got = autoLink([{ id: "a", names: ["RONDELLE"], sig: "a" }, { id: "b", names: ["Viti"], sig: "b" }],
      [{ code: "CD000001", qty: 1, names: ["WASHER"] }, { code: "CD000002", qty: 1, names: ["SCREW"] }]);
    expect(got.get("a")).toEqual({ code: "CD000001", sure: true });
    expect(got.get("b")).toEqual({ code: "CD000002", sure: true });
  });
});

const u = (id: string, name: string, sig = id): Unit => ({ id, names: [name, name], sig });
const many = (p: string, name: string, n: number): Unit[] => Array.from({ length: n }, (_, i) => u(`${p}${i}`, name, p));
const r = (code: string, qty: number | null, ...names: string[]): PartRow => ({ code, qty, names });
const link = (us: Unit[], rs: PartRow[]) => { const m = autoLink(us, rs); return (id: string) => m.get(id); };

describe("links the matcher must not make", () => {
  it("a different size of the same maker part is not this row", () => {
    expect(link([u("a", "GERMK-12")], [r("CM000014", 1, "GERMK-14 IGUS FORK")])("a")).toBeUndefined();
    const g = link([u("a", "GERMK-12"), u("b", "GERMK-14")], [r("CM000012", 1, "GERMK-12 IGUS FORK"), r("CM000014", 1, "GERMK-14 IGUS FORK")]);
    expect(g("a")?.code).toBe("CM000012");
    expect(g("b")?.code).toBe("CM000014");
  });
  it("Italian names put the thing first: a ring support is not a ring", () => {
    expect(link([u("a", "SUPPORTO ANELLO RM")], [r("CD000001", 1, "RING")])("a")).toBeUndefined();
    expect(link([u("a", "SUPPORTO ANELLO RM")], [r("CD000001", 1, "RING"), r("CD000002", 1, "SUPPORT")])("a")).toEqual({ code: "CD000002", sure: true });
  });
  it("English names put the thing last: a bearing is not a bearing support", () => {
    for (const [it, en] of [["cuscinetto", "BEARING SUPPORT"], ["molla", "SPRING PIN"], ["anello", "RING NUT"], ["dado", "RING NUT"], ["vite", "GRUB SCREW"], ["stelo", "TIE ROD"], ["anello", "O-RING 12"], ["cuscinetto", "SUPPORT FOR BEARING"]] as const)
      expect(link([u("a", it)], [r("CD000001", 1, en)])("a"), `${it} / ${en}`).toBeUndefined();
    expect(link([u("a", "ghiera")], [r("CD000001", 1, "RING NUT")])("a")).toEqual({ code: "CD000001", sure: true });
    expect(link([u("a", "anello")], [r("CD000001", 1, "RING", "ANELLO SUPPORTO")])("a")?.code).toBe("CD000001");
  });
  it("a row name that reads two ways is only a guess", () => {
    expect(link([u("a", "supporto")], [r("CD000001", 1, "BEARING SUPPORT")])("a")).toEqual({ code: "CD000001", sure: false });
    expect(link([u("a", "vite")], [r("CD000001", 1, "SCREW, SOCKET HEAD CAP")])("a")).toEqual({ code: "CD000001", sure: true });
  });
  it("a feed scroll is not a screw", () => {
    expect(link([u("a", "coclea")], [r("CD000001", 1, "SCREW M8X20")])("a")).toBeUndefined();
    expect(link([u("a", "vite")], [r("CD000001", 1, "TIMING SCREW")])("a")).toBeUndefined();
    expect(link([u("a", "coclea")], [r("CD000001", 1, "TIMING SCREW")])("a")?.code).toBe("CD000001");
  });
  it("count against quantity: more pieces than the row asks for is never sure", () => {
    expect(link(many("w", "rondella", 10), [r("CD000001", 2, "WASHER")])("w0")?.sure).toBe(false);
    // Two different washers, one row of four: only the four can be it.
    const g = link([...many("a", "rondella", 4), ...many("b", "rondella", 6)], [r("CD000001", 4, "WASHER")]);
    expect(g("a0")).toEqual({ code: "CD000001", sure: false });
    expect(g("b0")).toBeUndefined();
    // Two different screws, neither count fits: no telling.
    const h = link([...many("a", "vite", 6), ...many("b", "vite", 10)], [r("CD000001", 4, "SCREW")]);
    expect(h("a0")).toBeUndefined();
    expect(h("b0")).toBeUndefined();
  });
  it("three plates, two plate rows: the third is not dumped on a full row", () => {
    const g = link([u("a", "LAMIERA", "a"), u("b", "LAMIERA.1", "b"), u("c", "LAMIERA.2", "c")], [r("CD000001", 1, "PLATE"), r("CD000002", 1, "PLATE")]);
    expect([g("a"), g("b"), g("c")].filter(Boolean).length).toBe(2);
  });
  it("the last piece and the last row are not linked when the count disagrees", () => {
    expect(link([u("fl", "flangia"), ...many("s", "p7", 6)], [r("CD000001", 1, "FLANGE"), r("CD000002", 1, "MOTOR")])("s0")).toBeUndefined();
    expect(link([u("fl", "flangia"), u("s", "p7")], [r("CD000001", 1, "FLANGE"), r("CD000002", 2.5, "HOSE")])("s")).toBeUndefined();
    expect(link([u("fl", "flangia"), u("s", "ISO4762 M6x20")], [r("CD000001", 1, "FLANGE"), r("CD000002", null, "GREASE")])("s")).toBeUndefined();
  });
  it("quantity alone: screws the list doesn't have are not the bush", () => {
    // Four unlisted screws with a real name, and a bush row of four whose piece isn't in the model.
    expect(link([u("fl", "flangia"), ...many("s", "ISO4762 M6x20", 4)], [r("CD000001", 1, "FLANGE"), r("CM000001", 4, "BUSH")])("s0")).toBeUndefined();
    // Four screws and four unnamed bushes: the count can't tell them apart.
    expect(link([...many("s", "TCEI_M6", 4), ...many("p", "p3", 4)], [r("CM000001", 4, "BUSH"), r("CD000009", 1, "MOTOR")])("p0")).toBeUndefined();
    // A row its named pieces couldn't settle isn't given to an unnamed piece by count.
    expect(link([...many("a", "vite", 6), ...many("b", "vite", 10), ...many("p", "p3", 4)], [r("CD000001", 4, "SCREW")])("p0")).toBeUndefined();
  });
  it("the Italian name on the row beats a loose translation", () => {
    expect(link([u("a", "lamiera")], [r("CD000001", null, "PLATE", "PIASTRA"), r("CD000002", null, "SHEET", "LAMIERA")])("a")).toEqual({ code: "CD000002", sure: true });
  });
  it("a solid body named after a fillet is not a fitting", () => {
    expect(link([{ id: "a", names: ["p3", "Raccordo1"], sig: "a" }], [r("CD000001", 2, "FITTING"), r("CD000002", 3, "SCREW")])("a")).toBeUndefined();
  });
  it("sizes in the name must agree", () => {
    expect(link([u("a", "vite M8x30")], [r("CD000001", 1, "SCREW M8X20")])("a")).toBeUndefined();
    expect(link([u("a", "vite M8x30")], [r("CD000001", 1, "SCREW M8X20"), r("CD000002", 1, "SCREW M8X30")])("a")).toEqual({ code: "CD000002", sure: true });
  });
  it("still links what it should", () => {
    expect(link([u("a", "6204-2RS")], [r("CM000001", 1, "BEARING 6204-2RS", "", "6204-2RS", "SKF")])("a")).toEqual({ code: "CM000001", sure: true });
    expect(link([u("a", "M8x20")], [r("CM000001", 1, "SCREW M8X20")])("a")).toEqual({ code: "CM000001", sure: true });
    expect(link([u("a", "6204-2RS")], [r("CM000001", 1, "BEARING 6205-2RS")])("a")).toBeUndefined();
    expect(link([u("a", "flangia"), u("b", "p3")], [r("CD000001", 1, "FLANGE"), r("CD000002", 1, "COVER")])("b")).toEqual({ code: "CD000002", sure: false });
    expect(link([u("a", "tubo")], [r("CD000001", 2.5, "PIPE")])("a")).toEqual({ code: "CD000001", sure: true });
  });
});

describe("reading a part number off a name in the 3D file", () => {
  const codes = ["CD052968", "CM005152", "CM006026_1", "CD055542", "CM000147_1", "CM000147_2"];
  it("ignores the revision and copy numbers after the number", () => {
    expect(listCodeOf("CD052968_1_A.1.1.1.1.1", codes)).toBe("CD052968");
    expect(listCodeOf("cm005152_1_b.1", codes)).toBe("CM005152");
    expect(listCodeOf("CD055542.1", codes)).toBe("CD055542");
    expect(listCodeOf("CM006026_1-2", codes)).toBe("CM006026_1");
  });
  it("accepts the number without the list's suffix only when one row has it", () => {
    expect(listCodeOf("CM006026.3", codes)).toBe("CM006026_1");
    expect(listCodeOf("CM000147", codes)).toBeNull();
  });
  it("does not read a longer number as a shorter one", () => {
    expect(listCodeOf("CD0529681", codes)).toBeNull();
    expect(listCodeOf("CD052968B", codes)).toBeNull();
    expect(listCodeOf("SPESSORE", codes)).toBeNull();
  });
});

describe("fasteners named by their standard", () => {
  const rows: PartRow[] = [
    { code: "CM001228", qty: 4, names: ["SCREW TCEI UNI 5931", "VITE TCEI UNI 5931"] },
    { code: "CM000353", qty: 2, names: ["SCREW TE UNI 5739", "VITE TE UNI 5739"] },
    { code: "CM000292", qty: 4, names: ["FLAT WASHER UNI 6592-69", "RONDELLA PIANA UNI 6592-69"] },
    { code: "CM000300", qty: 4, names: ["WASHER GROWER UNI 1751", "RONDELLA GROWER UNI 1751"] },
    { code: "CM000139_1", qty: 1, names: ["O-RING", ""] },
  ];
  const many = (p: string, name: string, n: number): Unit[] => Array.from({ length: n }, (_, i) => ({ id: `${p}${i}`, names: [name, name], sig: p }));
  it("reads the ISO number as the UNI number of the same screw, washer or nut", () => {
    const got = autoLink([...many("a", "VITE_UNI_EN_ISO_4762TF_M8x125x30", 4), ...many("b", "VITE_UNI_EN_ISO_4017_M8x40", 2), ...many("c", "RONDELLA_UNI_EN_ISO_7089_D8", 4), ...many("d", "ROSETTA_UNI_1751_D8", 4), ...many("f", "UOR_INT_4337", 1)], rows);
    expect(got.get("a0")).toEqual({ code: "CM001228", sure: true });
    expect(got.get("b1")).toEqual({ code: "CM000353", sure: true });
    expect(got.get("c3")).toEqual({ code: "CM000292", sure: true });
    expect(got.get("d0")).toEqual({ code: "CM000300", sure: true });
    expect(got.get("f0")).toEqual({ code: "CM000139_1", sure: true });
  });
  it("links only the screws whose count fits when two sizes cite the row's standard, and only as a guess", () => {
    const got = autoLink([...many("a", "VITE_UNI_EN_ISO_4762TF_M8x125x30", 4), ...many("e", "u5931_M6x14", 1)], rows);
    expect(got.get("a0")).toEqual({ code: "CM001228", sure: false });
    expect(got.has("e0")).toBe(false);
  });
  it("keeps a hex screw off the socket screw row", () => {
    const got = autoLink(many("b", "VITE_UNI_EN_ISO_4017_M8x40", 4), [rows[0]!]);
    expect(got.size).toBe(0);
  });
  it("holds to a size the row gives", () => {
    const row: PartRow[] = [{ code: "CM000001", qty: 2, names: ["TCEI SCREW UNI 5931 M8 LENGTH 16"] }];
    expect(autoLink(many("a", "VITE_UNI5931_M8x16", 2), row).get("a0")?.code).toBe("CM000001");
    expect(autoLink(many("a", "VITE_UNI5931_M6x16", 2), row).size).toBe(0);
  });
});

describe("standard hardware (from the PC check of every 3D list)", () => {
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

describe("rules from the PC check of every 3D list", () => {
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

describe("part numbers with the CAD file type glued on", () => {
  it("reads CD058040PRT and CD056980ipt", () => {
    expect(listCodeOf("CD058040PRT", ["CD058040", "CD056980"])).toBe("CD058040");
    expect(listCodeOf("CD056980ipt", ["CD058040", "CD056980"])).toBe("CD056980");
    expect(listCodeOf("CD058040PRTX", ["CD058040"])).toBeNull();
  });
});

describe("telling copies from look-alikes by size", () => {
  const box = (x: number, y: number, z: number) => [[0, 0, 0], [x, 0, 0], [0, y, 0], [x, y, 0], [0, 0, z], [x, 0, z], [0, y, z], [x, y, z]];
  const of = (p: number[][]) => spread(p.length, (i, a) => p[i]![a]!);
  it("is the same for a copy that was turned and moved, and differs for another thickness", () => {
    const a = box(10, 10, 2);
    const turned = a.map(([x, y, z]) => [z! + 50, x! - 7, y! + 3]);
    expect(of(turned)).toBeCloseTo(of(a), 6);
    expect(Math.abs(of(box(10, 10, 5)) - of(a))).toBeGreaterThan(0.1);
  });
});

describe("links that were still open after the first pass", () => {
  const link = (name: string, rows: PartRow[]) => autoLink([{ id: "a", names: [name, name], sig: "a" }], rows).get("a")?.code ?? null;
  const row = (code: string, name: string, qty = 1): PartRow => ({ code, qty, names: [name, null] });
  it("reads short words it knows, and words written without spaces", () => {
    expect(link("OR.1", [row("A", "O-RING"), row("B", "PLATE")])).toBe("A");
    expect(link("tee", [row("A", "TEE"), row("B", "PLATE")])).toBe("A");
    expect(link("alberocentrale", [row("A", "SHAFT"), row("B", "PLATE")])).toBe("A");
    expect(link("vitediregolazione", [row("A", "SCREW"), row("B", "PLATE")])).toBe("A");
  });
  it("matches a key to the row that gives its section", () => {
    const rows = [row("K5", "TANG A5X5 UNI 6604-69"), row("K8", "TANG A8X7 UNI 6604-69")];
    expect(link("linguetta_5x5x12", rows)).toBe("K5");
    expect(link("linguetta_8x7x40", rows)).toBe("K8");
    expect(link("linguetta_6x6x30", rows)).toBeNull();
  });
  it("does not hold a maker's model name against the row", () => {
    expect(link("volantino_vds100ir_a", [row("H", "HANDWHEEL THENAR DSH100-12 COD. 32100F"), row("B", "PLATE")])).toBe("H");
  });
  it("knows makers' names and bearing numbers", () => {
    const rows = [row("R", "RADIAL BALL BEARING"), row("X", "AXIAL BALL BEARING"), row("C", "FESTO CYLINDER"), row("N", "NUT SCREW"), row("S", "SUCTION CUP")];
    expect(link("SKF_6006-2RS_30x55x13", rows)).toBe("R");
    expect(link("SKF_51107_35x52x12", rows)).toBe("X");
    expect(link("559241_DSNU-20-40-PPS", rows)).toBe("C");
    expect(link("JFRM-3244TR20x8P4", rows)).toBe("N");
    expect(link("VASB-30", rows)).toBe("S");
  });
});

describe("screw rows where only some carry the Italian name", () => {
  it("shares the screws over all the SCREW rows by quantity", () => {
    const names: [string, number][] = [["VITE_UNI_5933_M6x20211", 2], ["VITE_UNI_EN_ISO_4017_M10x3511", 2], ["VITE_UNI_EN_ISO_4017_M6x25111", 2], ["VITE_UNI_5933_M4x2011", 2], ["VITE_UNI_EN_ISO_4017_M8x3011", 4], ["VITE_UNI_EN_ISO_4762_M6x1x60111", 4]];
    const units: Unit[] = names.flatMap(([n, c], i) => Array.from({ length: c }, (_, k) => ({ id: `${i}-${k}`, names: [n, n], sig: `s${i}` })));
    const rows: PartRow[] = ([["A", 2, "VİDA"], ["B", 2, "VİDA"], ["C", 2, "VITE"], ["D", 2, "VİDA"], ["E", 4, "VITE"], ["F", 4, "ŚRUBA"], ["G", 4, "ВИНТ"]] as [string, number, string][]).map(([code, qty, it]) => ({ code, qty, names: ["SCREW", it] }));
    const got = autoLink(units, rows);
    expect(got.size).toBe(16);
    expect(new Set([...got.values()].map((l) => l.code)).size).toBe(6);
    expect([...got.values()].every((l) => !l.sure)).toBe(true);
  });
});

describe("one SCREW row with the Italian name among rows in other languages", () => {
  it("still shares the screws over every SCREW row (4017TP CA092137)", () => {
    const names: [string, number][] = [["VITE_UNI_EN_ISO_4762TF_M8x125x201", 2], ["VITE_UNI_EN_ISO_4017_M6x2515111", 4], ["VITE_UNI_5933_M6x201", 2], ["VITE_UNI_5933_M4x2011", 2]];
    const units: Unit[] = names.flatMap(([n, c], i) => Array.from({ length: c }, (_, k) => ({ id: `${i}-${k}`, names: [n, n], sig: `s${i}` })));
    const rows: PartRow[] = ([["CM008468", 2, "VİDA"], ["CM008469", 2, "VİDA"], ["CM008483", 2, "VITE"], ["CM007479", 4, "ŚRUBA"]] as [string, number, string][]).map(([code, qty, it]) => ({ code, qty, names: ["SCREW", it, null] }));
    const got = autoLink(units, rows);
    expect(got.size).toBe(10);
    expect(new Set([...got.values()].map((l) => l.code)).size).toBe(4);
    expect(got.get("1-0")!.code).toBe("CM007479");
  });
});
