import { describe, expect, it } from "vitest";
import { linkSubAssemblies, readChapter11, readPage, type PageText, type TextItem } from "../../src/shared/catalog/chapter11";
import { cleanPartCode, isPartCode } from "../../src/shared/catalog/model";

// A made-up construction-table page laid out like Ronchi's: drawing on the left with balloons,
// the parts table on the right, the title block at the bottom.
const t = (str: string, x: number, y: number, w = str.length * 5, h = 8): TextItem => ({ str, x, y, w, h });

function row(y: number, pos: string, code: string, rev: string, it: string, en: string, qty: string): TextItem[] {
  return [t(pos, 500, y), t(code, 520, y), t(rev, 580, y), t(it, 600, y), t(en, 720, y), t(qty, 830, y)];
}

const PAGE: PageText = {
  page: 7,
  width: 900,
  height: 600,
  items: [
    t("11.2 GRUPPI TAPPATORE", 40, 20),
    // balloons on the drawing
    t("1", 120, 100), t("2", 200, 160), t("3", 150, 300), t("1", 260, 330),
    // table header + rows
    t("POS.", 500, 80), t("CODICE", 520, 80), t("REV", 580, 80), t("DESCRIZIONE", 600, 80), t("DESCRIPTION", 720, 80), t("Q.TA", 830, 80),
    ...row(100, "1", "GF084883", "A", "SOLLEVAMENTO INFERIORE", "LIFT LOWER CAPPER", "1"),
    ...row(115, "2", "CM007710", "B", "RACCORDO", "COUPLING FITTING", "8"),
    ...row(130, "3", "CM009450_195", "", "TUBO PNEUMATICO", "PNEUMATIC PIPE", "1,5"),
    // title block
    t("GS095757", 600, 560), t("A", 660, 560), t("TAPPATORE", 680, 560), t("CAPPER", 760, 560), t("7/254", 850, 585),
  ],
};

describe("part codes", () => {
  it("knows Ronchi codes", () => {
    for (const c of ["GF010526", "CM009450_195", "CM004282_1", "0000025133", "TFP000091", "RA1018_GS102289", "RA1029TP_GF108519", "ELE00885", "ELE00018_04", "EL4197", "EL4197_12", "PV-RON-WD12345", "PV-RON-WD123456_1", "SKL-SCS-123456", "SKS-SCS-123456", "MC1234_1", "ADB1234"]) expect(isPartCode(c), c).toBe(true);
    for (const c of ["GF0105", "3651MB", "12", "hello", "GF010526_1234", "EL12", "ELE00885_123", "PV-RON-12345", "MC12"]) expect(isPartCode(c), c).toBe(false);
  });
  it("cleans what people type", () => {
    expect(cleanPartCode(" gf010526 ")).toBe("GF010526");
    expect(cleanPartCode("not a code")).toBeNull();
    expect(cleanPartCode(42)).toBeNull();
  });
});

describe("reading a construction-table page", () => {
  const s = readPage(PAGE);

  it("reads every row: position, code, revision, both names, quantity", () => {
    expect(s.rows).toEqual([
      { pos: "1", code: "GF084883", rev: "A", nameIt: "SOLLEVAMENTO INFERIORE", nameEn: "LIFT LOWER CAPPER", qty: 1, unit: null },
      { pos: "2", code: "CM007710", rev: "B", nameIt: "RACCORDO", nameEn: "COUPLING FITTING", qty: 8, unit: null },
      { pos: "3", code: "CM009450_195", rev: null, nameIt: "TUBO PNEUMATICO", nameEn: "PNEUMATIC PIPE", qty: 1.5, unit: null },
    ]);
  });

  it("reads the sheet's own assembly from the title block", () => {
    expect(s.code).toBe("GS095757");
    expect(s.rev).toBe("A");
    expect(s.titleIt).toBe("TAPPATORE");
    expect(s.titleEn).toBe("CAPPER");
    expect(s.group).toBe("GRUPPI TAPPATORE");
  });

  it("finds the balloons on the drawing, not the numbers in the table", () => {
    expect(s.balloons.map((b) => b.pos).sort()).toEqual(["1", "1", "2", "3"]);
    for (const b of s.balloons) {
      expect(b.x).toBeLessThan(0.5); // all on the drawing side
      expect(b.w).toBeGreaterThan(0);
      expect(b.x + b.w).toBeLessThanOrEqual(1.01);
    }
    expect(s.warnings).toEqual([]);
  });

  it("warns when a position has no balloon", () => {
    const missing = readPage({ ...PAGE, items: PAGE.items.filter((i) => !(i.str === "3" && i.x === 150)) });
    expect(missing.warnings).toContain("Position 3 was not found on the drawing.");
  });

  it("reads tables that put the position last", () => {
    const p = readPage({ page: 1, width: 900, height: 600, items: [t("CA000274", 520, 100), t("A", 580, 100), t("SUPPORTO", 600, 100), t("SUPPORT", 720, 100), t("1", 830, 100), t("4", 860, 100), t("4", 100, 100)] });
    expect(p.rows[0]).toMatchObject({ code: "CA000274", pos: "4", qty: 1, nameEn: "SUPPORT" });
  });

  it("keeps pipe sold by the meter", () => {
    const p = readPage({ page: 1, width: 900, height: 600, items: [t("6", 500, 100), t("CM009450_195", 520, 100), t("TUBO", 600, 100), t("PIPE", 720, 100), t("2", 820, 100), t("m", 840, 100)] });
    expect(p.rows[0]).toMatchObject({ qty: 2, unit: "m" });
  });

  it("handles a whole table line given as one string", () => {
    const p = readPage({ page: 1, width: 900, height: 600, items: [t("5 GF010526 A SUPPORTO           SUPPORT 2", 500, 100, 260)] });
    expect(p.rows[0]).toMatchObject({ pos: "5", code: "GF010526", rev: "A", nameIt: "SUPPORTO", nameEn: "SUPPORT", qty: 2 });
  });

  it("skips pages with no parts table", () => {
    const { sheets, skipped } = readChapter11([{ page: 1, width: 900, height: 600, items: [t("INDICE", 10, 10), t("11.1 GRUPPI RIEMPITRICE", 10, 30)] }, PAGE]);
    expect(skipped).toEqual([1]);
    expect(sheets).toHaveLength(1);
  });
});

describe("sub-assemblies", () => {
  it("links a sheet to the sheet that lists its code", () => {
    const parent = readPage(PAGE);
    const child = readPage({ page: 8, width: 900, height: 600, items: [...row(100, "1", "CA063257", "A", "INNESTO", "QUICK COUPLING", "1"), t("1", 100, 100), t("GF084883", 600, 560), t("LIFT", 680, 560)] });
    expect(linkSubAssemblies([parent, child])).toEqual(new Map([[8, 7]]));
  });
});

// Manuals up to about machine 4000: the drawing (no text at all) on one page, its table on the next.
describe("older manuals with the table on its own page", () => {
  const head = [t("529/292", 529, 805, 27, 12), t("11", 515, 51, 26, 24), t("3979 MB", 343, 60, 49, 12)];
  const list = (page: number, own: string, rows: TextItem[]): PageText => ({
    page, width: 595, height: 842,
    items: [
      ...head, t("GRUPPO LAVAGGIO", 149, 101, 76), t("WASHING UNIT", 292, 100, 56),
      t("ITEM", 64, 113, 17), t("CODE", 88, 113, 22), t("REV.", 128, 113, 16), t("DESCRIZIONE", 149, 113, 49), t("DESCRIPTION", 292, 112, 48), t("SPEC.", 435, 113, 21), t("QTY", 525, 113, 15),
      ...rows, t(own, 64, 100, 47),
    ],
  });
  const cells = (y: number, pos: string, code: string, rev: string, it: string, en: string, qty: string, spec: [string, number][] = []) => [
    t(pos, pos.length > 1 ? 71 : 72, y, 4 * pos.length, 7), t(code, 87, y, 32, 7), t(rev, 133, y, 5, 7), t(it, 148, y, it.length * 4, 7), t(en, 291, y, en.length * 4, 7),
    ...spec.map(([s, sy]) => t(s, 434, sy, s.length * 4, 7)), t(qty, qty.length > 1 ? 529 : 531, y, 4 * qty.length, 7),
  ];
  const TABLE = list(33, "GF089845/A", [
    ...cells(124, "1", "CD073536", "B", "CANNOTTO", "SLEEVE", "1"),
    ...cells(187, "8", "CM000123", "A", 'GUARNIZIONE "TRI-CLAMP"', '"TRI-CLAMP" SEAL', "2", [['40MP-F 2"', 187]]),
    ...cells(227, "12", "CM007250", "A", "GUARNIZIONE", "SEAL", "2", [["TRELLEBORG ZURCON", 223], ["PUA200630", 232]]),
    ...cells(340, "23", "CM008484", "A", "VITE", "SCREW", "16", [["UNI EN ISO 4762", 340]]),
    ...cells(353, "24", "XYZ", "A", "COSA", "THING", "1"),
  ]);
  const DRAWING: PageText = { page: 34, width: 595, height: 842, items: [t("34/292", 42, 805, 33, 12), t("11", 500, 51, 26, 24), t("3979 MB", 328, 60, 49, 12)] };

  it("reads the assembly's own number, revision and names from the line above the header", () => {
    expect(readPage(TABLE)).toMatchObject({ code: "GF089845", rev: "A", titleIt: "GRUPPO LAVAGGIO", titleEn: "WASHING UNIT" });
  });

  it("reads each row by its column, keeps a two-line SPEC out of the names, and leaves out what isn't a Ronchi number", () => {
    const s = readPage(TABLE);
    expect(s.rows).toEqual([
      { pos: "1", code: "CD073536", rev: "B", nameIt: "CANNOTTO", nameEn: "SLEEVE", qty: 1, unit: null },
      { pos: "8", code: "CM000123", rev: "A", nameIt: 'GUARNIZIONE "TRI-CLAMP"', nameEn: '"TRI-CLAMP" SEAL', qty: 2, unit: null },
      { pos: "12", code: "CM007250", rev: "A", nameIt: "GUARNIZIONE", nameEn: "SEAL", qty: 2, unit: null },
      { pos: "23", code: "CM008484", rev: "A", nameIt: "VITE", nameEn: "SCREW", qty: 16, unit: null },
    ]);
    expect(s.warnings).toEqual(['Position 24: "XYZ" is not a Ronchi part number, left out.']);
  });

  it("reads a table whose header words run together and has no SPEC. column", () => {
    const s = readPage({
      page: 7, width: 595, height: 842,
      items: [
        ...head, t("GS072091/A", 65, 109, 47), t("RIEMPITRICE", 169, 109, 50), t("FILLER", 345, 109, 25),
        t("ITEM CODE", 65, 123, 45), t("REV. DESCRIZIONE", 140, 123, 80), t("DESCRIPTION", 345, 123, 48), t("QTY", 520, 123, 15),
        t("1", 75, 134, 4, 7), t("CA000426", 93, 134, 32, 7), t("A", 149, 134, 5, 7), t("SUPPORTO", 168, 134, 40, 7), t("SUPPORT", 344, 134, 30, 7), t("1", 528, 134, 4, 7),
        t("10", 73, 144, 8, 7), t("CD031803", 93, 144, 32, 7), t("D", 149, 144, 5, 7), t("STAFFA", 168, 144, 25, 7), t("24", 526, 144, 8, 7), t("BRACKET", 344, 144, 30, 7),
      ],
    });
    expect(s).toMatchObject({ code: "GS072091", rev: "A", titleIt: "RIEMPITRICE", titleEn: "FILLER", warnings: [] });
    expect(s.rows).toEqual([
      { pos: "1", code: "CA000426", rev: "A", nameIt: "SUPPORTO", nameEn: "SUPPORT", qty: 1, unit: null },
      { pos: "10", code: "CD031803", rev: "D", nameIt: "STAFFA", nameEn: "BRACKET", qty: 24, unit: null },
    ]);
  });

  it("reads a table with no ITEM column and another second language, leaving the positions empty", () => {
    const s = readPage({
      page: 7, width: 595, height: 842,
      items: [
        ...head, t("GF007069/C", 65, 110, 47), t("RUOTA SUPPORTO ANELLO RM", 145, 110, 110), t("RAD STÜTZE RING RM", 332, 110, 80),
        t("BESCHREIBUNG", 332, 124, 55), t("CODE", 65, 124, 22), t("REV. DESCRIZIONE", 114, 124, 80), t("QTY", 519, 124, 15),
        t("CD036605", 64, 136, 32, 7), t("A", 124, 136, 5, 7), t("PIATTO", 144, 136, 25, 7), t("TELLER", 331, 136, 25, 7), t("1", 527, 136, 4, 7),
        t("CM003071", 64, 147, 32, 7), t("A", 124, 147, 5, 7), t("DADO", 144, 147, 20, 7), t("MUTTER", 331, 147, 25, 7), t("4", 527, 147, 4, 7),
      ],
    });
    expect(s).toMatchObject({ code: "GF007069", rev: "C", titleIt: "RUOTA SUPPORTO ANELLO RM", titleEn: "RAD STÜTZE RING RM", warnings: [] });
    expect(s.rows).toEqual([
      { pos: "", code: "CD036605", rev: "A", nameIt: "PIATTO", nameEn: "TELLER", qty: 1, unit: null },
      { pos: "", code: "CM003071", rev: "A", nameIt: "DADO", nameEn: "MUTTER", qty: 4, unit: null },
    ]);
  });

  it("draws the sheet from the page before the table, and joins a table that runs over two pages", () => {
    const more = list(34, "GF089845/A", cells(124, "25", "CM009055", "A", "CHIUSURA", "CLOSING DEVICE", "2"));
    const { sheets } = readChapter11([{ ...DRAWING, page: 32 }, TABLE]);
    expect(sheets.map((s) => [s.page, s.drawingPage, s.rows.length])).toEqual([[33, 32, 4]]);
    const long = readChapter11([{ ...DRAWING, page: 32 }, TABLE, more, { ...DRAWING, page: 35 }]);
    expect(long.sheets.map((s) => [s.page, s.drawingPage, s.rows.length])).toEqual([[33, 32, 5]]);
    // A table with no drawing page before it keeps none, rather than borrowing a neighbour's.
    expect(readChapter11([TABLE]).sheets[0]!.drawingPage).toBeUndefined();
  });

  it("leaves the newer one-page layout alone", () => {
    expect(readChapter11([PAGE]).sheets[0]!.drawingPage).toBeUndefined();
  });
});

describe("oldest manuals: TAV. pages with only part numbers and names", () => {
  const head = (code: string, page: number) => [t(`TAV. ${code} - COMM. 3697 TP`, 290, 66), t(`${page}/194`, 523, 817)];
  const drawing = (code: string, page: number): PageText => ({ page, width: 595, height: 842, items: head(code, page) });
  const TABLE: PageText = {
    page: 15, width: 595, height: 842,
    items: [
      ...head("GF011116/A", 15),
      t("CODE", 65, 126), t("ALZA ABBASSA TAPPATORE", 146, 126), t("CAPPER LIFT-UP/DOWN", 343, 126),
      t("MOTORIZZATO CON CARICO TAPPI", 146, 141), t("MOTORIZATION WITH CAPS", 343, 141),
      t("LOADING", 343, 156),
      t("CD001274", 65, 170), t("ALBERO", 145, 170), t("SHAFT", 342, 170),
      t("CM002983", 65, 183), t("MOTORE SIEMENS 1LA7073-4AB92-", 145, 183), t("MOTOR SIEMENS 1LA7073-4AB92-", 342, 183),
      t("B14 IP55 4 POLI NORME U.L.", 145, 195), t("B14 IP55 4 POLES RULES U.L.", 342, 195),
      // pdf.js sometimes hands the cells of a line over out of order
      t("FLANGE", 346, 207), t("CD049399", 65, 207), t("FLANGIA", 146, 207),
    ],
  };

  it("reads the assembly from the heading, its names from the CODE line, and rows with no position or quantity", () => {
    const s = readPage(TABLE);
    expect(s).toMatchObject({ code: "GF011116", rev: "A", titleIt: "ALZA ABBASSA TAPPATORE MOTORIZZATO CON CARICO TAPPI", titleEn: "CAPPER LIFT-UP/DOWN MOTORIZATION WITH CAPS LOADING" });
    expect(s.rows).toEqual([
      { pos: "", code: "CD001274", rev: null, nameIt: "ALBERO", nameEn: "SHAFT", qty: null, unit: null },
      { pos: "", code: "CM002983", rev: null, nameIt: "MOTORE SIEMENS 1LA7073-4AB92- B14 IP55 4 POLI NORME U.L.", nameEn: "MOTOR SIEMENS 1LA7073-4AB92- B14 IP55 4 POLES RULES U.L.", qty: null, unit: null },
      { pos: "", code: "CD049399", rev: null, nameIt: "FLANGIA", nameEn: "FLANGE", qty: null, unit: null },
    ]);
    expect(s.warnings).toEqual([]);
  });

  it("pairs each table with the drawing page before it, and skips the drawing pages", () => {
    const { sheets, skipped } = readChapter11([drawing("GF011116/A", 14), TABLE, drawing("GF020000/B", 16)]);
    expect(sheets).toHaveLength(1);
    expect(sheets[0]!.drawingPage).toBe(14);
    expect(skipped).toEqual([14, 16]);
  });
});
