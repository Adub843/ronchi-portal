import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "../../src/shared/csv";
import { parseServiceReportName } from "../../src/shared/service-report";
import { scanForCustomerData } from "../../src/shared/privacy";
import { allowedNext, dailyTotals, localDay, parseRange, stateAfter, toShifts, type PunchKind } from "../../src/portal/lib/hours";
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

describe("hours", () => {
  const p = (id: string, kind: PunchKind, at: string) => ({ id, user_id: "u", kind, at });
  it("pairs punches and splits regular and overtime per local day", () => {
    const shifts = toShifts([p("1", "in", "2026-11-23T12:00:00Z"), p("2", "out", "2026-11-23T22:30:00Z"), p("3", "in", "2026-11-24T13:00:00Z")]);
    expect(shifts.map((s) => s.hours)).toEqual([10.5, 0]);
    const days = dailyTotals(shifts);
    expect(days[0]).toMatchObject({ day: "2026-11-23", hours: 10.5, regular: 8, overtime: 2.5, open: false });
    expect(days[1]).toMatchObject({ day: "2026-11-24", open: true });
  });
  it("takes break time out of worked hours and shows it separately", () => {
    const shifts = toShifts([
      p("1", "in", "2026-11-23T12:00:00Z"),
      p("2", "break_start", "2026-11-23T16:00:00Z"),
      p("3", "break_end", "2026-11-23T16:30:00Z"),
      p("4", "break_start", "2026-11-23T19:00:00Z"),
      p("5", "break_end", "2026-11-23T19:15:00Z"),
      p("6", "out", "2026-11-23T22:00:00Z"),
    ]);
    expect(shifts[0]).toMatchObject({ hours: 9.25, breakHours: 0.75, onBreak: false });
    expect(dailyTotals(shifts)[0]).toMatchObject({ hours: 9.25, breakHours: 0.75, regular: 8, overtime: 1.25 });
  });
  it("clocking out while on break ends the break at the clock-out time", () => {
    const shifts = toShifts([p("1", "in", "2026-11-23T12:00:00Z"), p("2", "break_start", "2026-11-23T20:00:00Z"), p("3", "out", "2026-11-23T21:00:00Z")]);
    expect(shifts[0]).toMatchObject({ hours: 8, breakHours: 1 });
  });
  it("shows someone still on break, and ignores stray break punches outside a shift", () => {
    const open = toShifts([p("1", "in", "2026-11-23T12:00:00Z"), p("2", "break_start", "2026-11-23T16:00:00Z")]);
    expect(dailyTotals(open)[0]).toMatchObject({ open: true, onBreak: true, hours: 0 });
    expect(toShifts([p("1", "break_start", "2026-11-23T12:00:00Z"), p("2", "break_end", "2026-11-23T13:00:00Z")])).toEqual([]);
  });
  it("only allows punches that make sense next", () => {
    expect(stateAfter(undefined)).toBe("out");
    expect(stateAfter("break_start")).toBe("on_break");
    expect(stateAfter("break_end")).toBe("working");
    expect(allowedNext("out")).toEqual(["in"]);
    expect(allowedNext("working")).toEqual(["break_start", "out"]);
    expect(allowedNext("on_break")).toEqual(["break_end", "out"]);
  });
  it("uses Ronchi's local day, not UTC", () => {
    expect(localDay("2026-11-24T03:00:00Z")).toBe("2026-11-23");
  });
  it("rejects silly ranges", () => {
    expect(parseRange("2026-12-01", "2026-01-01")).toBeNull();
    expect(parseRange("2020-01-01", "2026-01-01")).toBeNull();
    expect(parseRange(undefined, undefined)).not.toBeNull();
  });
});

describe("roles", () => {
  it("denies by default", () => {
    expect(can(null, "boards.use")).toBe(false);
    expect(can("tech", "users.manage")).toBe(false);
    expect(can("sales", "hours.view_all")).toBe(false);
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
