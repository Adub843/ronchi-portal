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
    for (const c of ["GF010526", "CM009450_195", "CM004282_1", "0000025133", "TFP000091", "RA1018_GS102289", "ELE00885", "ELE00018_04", "EL4197", "EL4197_12", "PV-RON-WD12345", "PV-RON-WD123456_1", "SKL-SCS-123456", "SKS-SCS-123456", "MC1234_1", "ADB1234"]) expect(isPartCode(c), c).toBe(true);
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
