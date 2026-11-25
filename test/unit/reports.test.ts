import { describe, expect, it } from "vitest";
import { cleanRow, EXPENSE_TYPES, fmtHours, hoursToMin, next, sheetTotals, weekOf, workMinutes } from "../../src/shared/reports";

describe("time sheet hours", () => {
  it("work hours are end minus start minus the break", () => {
    expect(workMinutes({ start_time: "07:30", end_time: "16:00", break_min: 30 })).toBe(480);
    expect(workMinutes({ start_time: "08:00", end_time: "08:00", break_min: 0 })).toBe(0);
  });
  it("a shift past midnight counts into the next day", () => {
    expect(workMinutes({ start_time: "22:00", end_time: "02:00", break_min: 0 })).toBe(240);
  });
  it("no hours until both times are in, and never below zero", () => {
    expect(workMinutes({ start_time: "07:00", end_time: null, break_min: 0 })).toBe(0);
    expect(workMinutes({ start_time: "07:00", end_time: "07:30", break_min: 60 })).toBe(0);
  });
  it("totals split billable and non-billable, and add travel and production", () => {
    const t = sheetTotals([
      { start_time: "07:00", end_time: "15:30", break_min: 30, travel_min: 90, production_min: 240, billable: 1 },
      { start_time: "09:00", end_time: "12:00", break_min: 0, travel_min: 0, production_min: 0, billable: 0 },
    ]);
    expect(t).toEqual({ work: 660, billable: 480, nonBillable: 180, travel: 90, production: 240, days: 2 });
  });
  it("shows hours with two decimals and reads typed hours", () => {
    expect(fmtHours(450)).toBe("7.50");
    expect(fmtHours(0)).toBe("0.00");
    expect(hoursToMin("1.5")).toBe(90);
    expect(hoursToMin("1,25")).toBe(75);
    expect(hoursToMin("")).toBe(0);
    expect(hoursToMin("abc")).toBeNull();
  });
  it("finds the Monday of a date's week", () => {
    expect(weekOf("2026-11-25")).toBe("2026-11-23"); // a Wednesday
    expect(weekOf("2026-11-29")).toBe("2026-11-23"); // Sunday belongs to the week before
    expect(weekOf("2026-11-23")).toBe("2026-11-23");
  });
});

describe("checking typed rows", () => {
  it("a day needs a real date and HH:MM times", () => {
    expect(cleanRow("days", { work_date: "2026-12-01", start_time: "7:30", end_time: "16:00", break_min: 30, travel_hours: "1.5", billable: true }, false))
      .toEqual({ fields: { work_date: "2026-12-01", start_time: "07:30", end_time: "16:00", break_min: 30, travel_min: 90, production_min: 0, billable: 1, notes: null } });
    expect(cleanRow("days", { work_date: "2026-02-30" }, false).error).toMatch(/date/i);
    expect(cleanRow("days", { work_date: "2026-12-01", start_time: "25:00" }, false).error).toMatch(/time/i);
    expect(cleanRow("days", { break_min: -5 }, true).error).toMatch(/break/i);
    expect(cleanRow("days", { travel_hours: "30" }, true).error).toMatch(/travel/i);
  });
  it("a partial change only touches the fields sent", () => {
    expect(cleanRow("days", { notes: "  Line 2  " }, true)).toEqual({ fields: { notes: "Line 2" } });
  });
  it("expenses keep a type, description and quantity, and never take a money amount", () => {
    const r = cleanRow("expenses", { exp_date: "2026-12-01", type: "mileage", description: "Airport to plant", quantity: "42", amount: 120, cost: "$5" }, false);
    expect(r.fields).toEqual({ exp_date: "2026-12-01", type: "mileage", description: "Airport to plant", quantity: 42 });
    expect(cleanRow("expenses", { type: "caviar" }, true).error).toBeTruthy();
    expect(EXPENSE_TYPES.map((e) => e.id)).toContain("hotel");
  });
  it("parts are used or needed, with a whole quantity", () => {
    expect(cleanRow("parts", { kind: "used", part_code: " 12.345.678 ", qty: "2" }, false).fields).toMatchObject({ kind: "used", part_code: "12.345.678", qty: 2 });
    expect(cleanRow("parts", { kind: "needed", qty: "1.5" }, false).error).toMatch(/quantity/i);
    expect(cleanRow("parts", { kind: "spare" }, false).error).toBeTruthy();
  });
  it("caps text lengths", () => {
    expect(cleanRow("log", { work_date: "2026-12-01", text: "x".repeat(5001) }, false).error).toMatch(/long/i);
  });
});

describe("review steps", () => {
  it("draft or sent back can be sent; sent can be approved or sent back; approved only sent back", () => {
    expect(next("draft", "send")).toBe("sent");
    expect(next("returned", "send")).toBe("sent");
    expect(next("sent", "approve")).toBe("approved");
    expect(next("sent", "return")).toBe("returned");
    expect(next("approved", "return")).toBe("returned");
    expect(next("sent", "recall")).toBe("draft");
    expect(next("approved", "send")).toBeNull();
    expect(next("draft", "approve")).toBeNull();
    expect(next("approved", "recall")).toBeNull();
  });
});
