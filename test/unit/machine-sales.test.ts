import { describe, expect, it } from "vitest";
import { BOARD, LINE, STAGES, chanceOf, daysSince, flags, stageNeeds, weighted } from "../../src/shared/machine-sales";

const base = { stage: "firm_quote", stage_at: "2026-11-20T10:00:00.000Z", next_step: "Call", next_step_date: "2026-12-05", hold_until: null, expected_po: "2027-01" };

describe("machine sales rules", () => {
  it("has 14 stages on the line, 7 of them on the board, with On hold and Lost beside it", () => {
    expect(LINE).toHaveLength(14);
    expect(BOARD).toHaveLength(7);
    expect(STAGES.filter((s) => !LINE.includes(s))).toEqual(["on_hold", "lost"]);
  });
  it("flags nothing on a healthy deal", () => {
    expect(flags(base, "2026-11-27")).toEqual([]);
  });
  it("turns a deal red when it sits past the days allowed for its stage", () => {
    expect(daysSince(base.stage_at, "2026-12-04")).toBe(14);
    expect(flags(base, "2026-12-04")).toEqual([]); // 14 allowed in Firm quote
    expect(flags({ ...base, next_step_date: "2026-12-20" }, "2026-12-05")).toEqual(["stale"]);
  });
  it("flags a missing or overdue next step and a PO month that has passed", () => {
    expect(flags({ ...base, next_step: null }, "2026-11-27")).toEqual(["no_next"]);
    expect(flags({ ...base, next_step_date: "2026-11-26" }, "2026-11-27")).toEqual(["next_due"]);
    expect(flags({ ...base, expected_po: "2026-10" }, "2026-11-27")).toEqual(["po_passed"]);
    expect(flags({ ...base, stage: "build", expected_po: "2026-10" }, "2026-11-27")).toEqual([]); // sold already
  });
  it("never turns an On hold deal red; it asks to reconnect on its date", () => {
    const held = { ...base, stage: "on_hold", stage_at: "2026-01-01T00:00:00Z", next_step: null, hold_until: "2026-12-01" };
    expect(flags(held, "2026-11-27")).toEqual([]);
    expect(flags(held, "2026-12-01")).toEqual(["reconnect"]);
  });
  it("flags nothing on finished deals", () => {
    expect(flags({ ...base, stage: "lost", next_step: null }, "2027-06-01")).toEqual([]);
    expect(flags({ ...base, stage: "paid", next_step: null }, "2027-06-01")).toEqual([]);
  });
  it("weights a deal by the typed chance, or the stage's usual one", () => {
    expect(chanceOf({ stage: "firm_quote" })).toBe(65);
    expect(weighted({ stage: "firm_quote", value: 1000000 })).toBe(650000);
    expect(weighted({ stage: "firm_quote", chance: 90, value: 1000000 })).toBe(900000);
    expect(weighted({ stage: "lost", value: 1000000 })).toBe(0);
  });
  it("says what a stage needs first", () => {
    expect(stageNeeds("won")).toBe("customer_po");
    expect(stageNeeds("build")).toBe("customer_po");
    expect(stageNeeds("lost")).toBe("lost_reason");
    expect(stageNeeds("on_hold")).toBe("hold_until");
    expect(stageNeeds("negotiation")).toBeNull();
  });
});

import { nextStatuses, quoteTotals, readQuoteLines } from "../../src/shared/machine-quotes";

describe("machine quotes", () => {
  it("adds up the lines, leaves options out of the total, and takes the discount off", () => {
    const t = quoteTotals([
      { qty: 1, unit_price: 800000, optional: false, origin: "italy" },
      { qty: 2, unit_price: 50000, optional: false, origin: "us" },
      { qty: 1, unit_price: 30000, optional: true, origin: "italy" },
    ], 5);
    expect(t).toMatchObject({ subtotal: 900000, discount: 45000, total: 855000, options: 30000, italy: 800000, us: 100000, priced: true });
    expect(quoteTotals([{ qty: 1, unit_price: null, optional: false, origin: "italy" }]).priced).toBe(false);
    expect(quoteTotals([]).priced).toBe(false);
  });
  it("checks the lines people type", () => {
    expect(readQuoteLines([{ description: " Filler ", qty: "2", unit_price: "$1,200.50" }]).lines).toEqual([{ description: "Filler", detail: null, origin: "italy", qty: 2, unit_price: 1200.5, optional: false }]);
    expect(readQuoteLines([{ description: "" }]).problem).toBeTruthy();
    expect(readQuoteLines([{ description: "X", qty: 0 }]).problem).toBeTruthy();
    expect(readQuoteLines([{ description: "X", unit_price: "lots" }]).problem).toBeTruthy();
    expect(readQuoteLines("no").problem).toBeTruthy();
  });
  it("a sent quote is answered, not edited", () => {
    expect(nextStatuses("draft")).toEqual(["sent"]);
    expect(nextStatuses("sent")).toEqual(["accepted", "declined"]);
    expect(nextStatuses("superseded")).toEqual([]);
  });
});

import { bucketOf, quarter, readDealsCsv, readMonth, yearReport } from "../../src/shared/machine-forecast";

describe("machine forecast and import", () => {
  it("finds the quarter and puts each deal in its column", () => {
    expect(quarter("2026-11-27")).toEqual({ label: "Q4 2026", months: ["2026-10", "2026-11", "2026-12"] });
    expect(quarter("2026-11-27", 1)).toEqual({ label: "Q1 2027", months: ["2027-01", "2027-02", "2027-03"] });
    expect(quarter("2026-02-01", -1).label).toBe("Q4 2025");
    const q = quarter("2026-11-27").months;
    expect(bucketOf({ stage: "negotiation", expected_po: "2026-12" }, q)).toBe("commit");
    expect(bucketOf({ stage: "firm_quote", expected_po: "2026-12" }, q)).toBe("best");
    expect(bucketOf({ stage: "lead", expected_po: "2026-10" }, q)).toBe("pipeline");
    expect(bucketOf({ stage: "lead", chance: 90, expected_po: "2026-10" }, q)).toBe("commit");
    expect(bucketOf({ stage: "firm_quote", expected_po: "2027-02" }, q)).toBeNull();
    expect(bucketOf({ stage: "firm_quote" }, q)).toBeNull();
    expect(bucketOf({ stage: "build", won_at: "2026-10-05T10:00:00Z" }, q)).toBe("won");
    expect(bucketOf({ stage: "build", won_at: "2026-03-05T10:00:00Z" }, q)).toBeNull();
    expect(bucketOf({ stage: "lost", expected_po: "2026-12" }, q)).toBeNull();
  });
  it("reports the last 12 months", () => {
    const r = yearReport([
      { stage: "build", value: 500000, won_at: "2026-06-01T00:00:00Z", created_at: "2026-01-01T00:00:00Z" },
      { stage: "paid", value: 300000, won_at: "2024-06-01T00:00:00Z", created_at: "2024-01-01T00:00:00Z" },
      { stage: "lost", lost_at: "2026-09-01T00:00:00Z", lost_reason: "Price" },
      { stage: "lost", lost_at: "2026-10-01T00:00:00Z", lost_reason: "Price" },
      { stage: "lost", lost_at: "2026-10-02T00:00:00Z" },
    ], "2026-11-27");
    expect(r).toMatchObject({ won: 1, wonValue: 500000, lost: 3, winRate: 25, daysToWin: 151 });
    expect(r.reasons).toEqual([["Price", 2], ["No reason given", 1]]);
  });
  it("reads a sales list from a spreadsheet", () => {
    expect(readMonth("3/2027")).toBe("2027-03");
    expect(readMonth("03/15/2027")).toBe("2027-03");
    expect(readMonth("2027-3-9")).toBe("2027-03");
    expect(readMonth("March 2027")).toBe("2027-03");
    expect(readMonth("soon")).toBe("");
    const r = readDealsCsv('Customer,Project,Amount,Status,Close date,Sales rep\n"Acme, Inc.",Filler,"$1,250,000",Firm quote,3/2027,Andrew\nBeta,Capper,,PO received,,\n,Nobody,,,,\nGamma,X,,Dreaming,,\nDelta,Y,lots,,,');
    expect(r.rows).toEqual([
      { customer: "Acme, Inc.", title: "Filler", value: "$1,250,000", stage: "firm_quote", expected_po: "2027-03", owner: "Andrew" },
      { customer: "Beta", title: "Capper", value: "", stage: "won", expected_po: "", owner: "" },
    ]);
    expect(r.problems).toHaveLength(3);
    expect(readDealsCsv("Name,Value\nA,1").problems).toEqual(["No Customer column was found."]);
  });
});
