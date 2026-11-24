import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "../../src/shared/csv";
import { isOpen, mapHeader, normalDate, parseCsv } from "../../src/shared/change-parts";
import { parseServiceReportName } from "../../src/shared/service-report";
import { scanForCustomerData } from "../../src/shared/privacy";
import { can, PERMISSIONS } from "../../src/portal/lib/roles";
import { THEMES } from "../../src/shared/themes";

describe("service report file names", () => {
  it("reads the machine and date", () => {
    expect(parseServiceReportName("SR - AL - 26-0326-S1 - 3069MB - 10-19-26.pdf")).toEqual({ tech: "AL", project: "26-0326-S1", machine: "3069MB", date: "2026-10-19" });
  });
  it("returns null for other files", () => {
    expect(parseServiceReportName("Manual 4222TP.pdf")).toBeNull();
    expect(parseServiceReportName("SR - AL - no machine - 10-19-26")).toBeNull();
  });
});

describe("customer privacy check", () => {
  const terms = { customers: ["Acme Labs"], sites: ["Columbus Plant"], serials: ["3069MB"] };
  it("finds customer names, sites and machine numbers", () => {
    const f = scanForCustomerData("At ACME labs (columbus plant) machine 3069mb jammed", terms);
    expect(f.map((x) => x.kind).sort()).toEqual(["customer", "machine_number", "site"]);
  });
  it("finds machine numbers not in the registry yet", () => {
    expect(scanForCustomerData("unit 4411TP had the issue", terms)).toEqual([{ kind: "machine_number", match: "4411TP" }]);
  });
  it("passes clean text", () => {
    expect(scanForCustomerData("Re-grease the capper clutch every 500 hours.", terms)).toEqual([]);
  });
});

describe("CSV export", () => {
  it("defuses spreadsheet formulas", () => {
    for (const bad of ["=1+1", "+1", "-1", "@SUM(A1)", "\tx"]) expect(csvCell(bad).replace(/^"/, "")).toMatch(/^'/);
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(toCsv(["a"], [[1]])).toBe("﻿a\r\n1\r\n");
  });
});

describe("roles", () => {
  it("denies by default", () => {
    expect(can(null, "boards.use")).toBe(false);
    expect(can("tech", "users.manage")).toBe(false);
    expect(can("sales", "machines.edit")).toBe(false);
  });
  it("only admin manages people or reads the audit log", () => {
    for (const [role, perms] of Object.entries(PERMISSIONS)) {
      expect(perms.has("users.manage"), role).toBe(role === "admin");
      expect(perms.has("audit.view"), role).toBe(role === "admin");
    }
  });
});

describe("themes", () => {
  it("has the Ronchi default plus 19 looks, without Ronchi Red Steel", () => {
    expect(THEMES).toHaveLength(20);
    expect(THEMES[0]!.id).toBe("ronchi");
    expect(THEMES.some((t) => t.name === "Ronchi Red Steel" || t.id === "T1")).toBe(false);
  });
});

describe("change-part spreadsheet reading", () => {
  it("reads quoted cells, commas and line breaks", () => {
    expect(parseCsv('﻿a,"b, c","d ""q"""\r\n1,"x\ny",3\n')).toEqual([["a", "b, c", 'd "q"'], ["1", "x\ny", "3"]]);
  });
  it("understands the usual date styles and rejects nonsense", () => {
    expect(normalDate("11/24/2026")).toBe("2026-11-24");
    expect(normalDate("1/5/26")).toBe("2026-01-05");
    expect(normalDate("2026-11-24")).toBe("2026-11-24");
    expect(normalDate("2/30/2026")).toBeNull();
    expect(normalDate("TBD")).toBeNull();
    expect(normalDate("December 11, 2026")).toBe("2026-12-11");
    expect(normalDate("Mid Nov 2026")).toBeNull();
  });
  it("matches column names however they're written", () => {
    const { map, unknown } = mapHeader(["Cust. P.O. #", "Serial Number", "Customer", "Samples Rcvd", "Whatever"]);
    expect(map).toMatchObject({ customer_po: 0, machine: 1, customer: 2, samples_received: 3 });
    expect(unknown).toEqual([{ index: 4, name: "Whatever" }]);
  });
  it("knows which statuses are finished", () => {
    expect(isOpen("In design")).toBe(true);
    expect(isOpen(null)).toBe(true);
    expect(isOpen("Shipped")).toBe(false);
    expect(isOpen("cancelled")).toBe(false);
  });
});
