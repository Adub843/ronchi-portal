// Rules carried over from the old Field Service Workbook (src/shared/workbook.ts).
import { describe, expect, it } from "vitest";
import { billableFor, cleanHours, hoursTotal, isDay, issueLines, mondayOf, reportText, toCents } from "../../src/shared/workbook";

describe("billable hours (customer billing, not a time clock)", () => {
  it("takes hours by type and miles, rounding to hundredths", () => {
    expect(cleanHours({ regular: "8", overtime: 2.333, travel_wd: "", miles: "42.26" })).toEqual({ travel_wd: 0, travel_we: 0, regular: 8, training: 0, overtime: 2.33, warranty: 0, miles: 42.3 });
  });
  it("refuses negative hours, more than 24 in a day, and text", () => {
    expect(() => cleanHours({ regular: -1 })).toThrow("between 0 and 24");
    expect(() => cleanHours({ regular: 16, overtime: 9 })).toThrow("more than 24");
    expect(() => cleanHours({ regular: "eight" })).toThrow("must be a number");
  });
  it("adds up every type except miles", () => {
    expect(hoursTotal({ regular: 8, overtime: 2, travel_wd: 1.5 })).toBe(11.5);
  });
});

describe("expenses", () => {
  it("reads money amounts as cents", () => {
    expect(toCents("12.50")).toBe(1250);
    expect(toCents("$1,234")).toBe(123400);
    expect(toCents(7.1)).toBe(710);
    expect(toCents("")).toBe(0);
    expect(() => toCents("12.345")).toThrow("12.50");
    expect(() => toCents("abc")).toThrow();
  });
  it("marks costs on S and W job numbers billable, others not (the old workbook's rule)", () => {
    expect(billableFor("26-0287-S1")).toBe("Y");
    expect(billableFor("26-0301-W2")).toBe("Y");
    expect(billableFor("TOOLS")).toBe("N");
    expect(billableFor(null)).toBe("N");
  });
});

describe("days and weeks", () => {
  it("finds the Monday of a week and checks dates", () => {
    expect(mondayOf("2026-11-25")).toBe("2026-11-23");
    expect(mondayOf("2026-11-29")).toBe("2026-11-23");
    expect(mondayOf("2026-11-23")).toBe("2026-11-23");
    expect(isDay("2026-02-30")).toBe(false);
    expect(isDay("2026-11-25")).toBe(true);
  });
});

describe("Submit", () => {
  it("turns each problem line into a quick-note title", () => {
    expect(issueLines("- Starwheel worn\n2) Capper head 4 slips\n\nok")).toEqual(["Starwheel worn", "Capper head 4 slips"]);
  });
  it("writes the report for the office email with log, hours, expenses and sign-off", () => {
    const r = reportText({
      job: { job_number: "26-0287-S1", customer: "Acme", machine: "3069MB", location: "Pottstown" },
      report: { scope: "Line Down", summary: "Replaced the starwheel.", open_issues: "Order a spare", sign_name: "Dana Smith", sign_title: "Maintenance Manager", sign_date: "2026-11-25", signature: "data:image/png;base64,xx" },
      entries: [{ day: "2026-11-24", who: "Aaron Lewis", work: "Line Down", description: "Found worn starwheel", done: "N", pct: "51–75%", issues: "Starwheel worn" }],
      hours: [{ day: "2026-11-24", who: "Aaron Lewis", travel_wd: 2, travel_we: 0, regular: 8, training: 0, overtime: 1, warranty: 0, miles: 40 }],
      expenses: [{ day: "2026-11-24", who: "Aaron Lewis", type: "Hotel", amount_cents: 12900, billable: "Y", description: "Hampton Inn" }],
      photos: 3, by: "Aaron Lewis", link: "https://portal/jobs/j1/work-order",
    });
    expect(r.subject).toBe("Service report 26-0287-S1: Acme 3069MB");
    expect(r.text).toContain("Found worn starwheel [51–75%]");
    expect(r.text).toContain("Total billable hours: 11");
    expect(r.text).toContain("Hotel 129.00 (billable)");
    expect(r.text).toContain("Signed off by Dana Smith, Maintenance Manager on 2026-11-25");
    expect(r.text).toContain("3 photos");
  });
});
