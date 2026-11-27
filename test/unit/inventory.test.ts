import { describe, expect, it } from "vitest";
import { available, isLow, isOut, readStockCsv } from "../../src/shared/inventory";

describe("inventory rules", () => {
  it("available is on hand less what orders hold", () => {
    expect(available({ on_hand: 10, reserved: 4 })).toBe(6);
  });
  it("low when available falls to the reorder point; out when nothing is on the shelf", () => {
    expect(isLow({ on_hand: 10, reserved: 6, reorder_point: 4 })).toBe(true);
    expect(isLow({ on_hand: 10, reserved: 0, reorder_point: 4 })).toBe(false);
    expect(isLow({ on_hand: 3, reserved: 0, reorder_point: null })).toBe(false);
    expect(isOut({ on_hand: 0, reserved: 0, reorder_point: 4 })).toBe(true);
    expect(isLow({ on_hand: 0, reserved: 0, reorder_point: 4 })).toBe(false); // shown as out, not both
    expect(isOut({ on_hand: 0, reserved: 0, reorder_point: 4, active: false })).toBe(false);
  });
  it("reads a stock list whatever the columns are called, with quoted cells and semicolons", () => {
    const a = readStockCsv('Part Number,Name,Bin,On hand,Min\nCM000240,"Washer, grower",A3-2,40,10\n\nR10-2231,O-ring kit,A1-1,4,\n');
    expect(a.problems).toEqual([]);
    expect(a.rows).toEqual([
      { part_code: "CM000240", description: "Washer, grower", location: "A3-2", qty: "40", reorder_point: "10" },
      { part_code: "R10-2231", description: "O-ring kit", location: "A1-1", qty: "4", reorder_point: "" },
    ]);
    const b = readStockCsv("Code;Quantity\nX1;2,5\n");
    expect(b.rows).toEqual([{ part_code: "X1", qty: "2,5" }]);
  });
  it("says what is wrong with a list it can't read", () => {
    expect(readStockCsv("Shelf,Notes\nA1,x").problems).toEqual(["No Part number column was found.", "No Quantity column was found."]);
    const r = readStockCsv("Part,Qty\n,3\nA,many\nB,2");
    expect(r.rows).toEqual([{ part_code: "B", qty: "2" }]);
    expect(r.problems).toEqual(["Line 2 has no part number.", "Line 3: the quantity must be a number."]);
  });
});
