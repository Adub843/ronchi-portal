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
