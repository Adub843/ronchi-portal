import { describe, expect, it } from "vitest";
import { codeOf } from "../../web/catalog/codes";

describe("matching 3D part names to part codes", () => {
  it("reads every kind of Ronchi part code from a CAD name, dropping the copy number", () => {
    const cases: [string, string][] = [
      ["GF010526-1", "GF010526"],
      ["CM009450_195", "CM009450_195"],
      ["ELE00885-1", "ELE00885"],
      ["PV-RON-WD123456-2", "PV-RON-WD123456"],
      ["RA1018_GS102289", "RA1018_GS102289"],
      ["SKL-SCS-123456 seal kit", "SKL-SCS-123456"],
      ["0000025133", "0000025133"],
      // Real names from Ronchi STEP files: revision letter, instance numbers, Italian notes.
      ["CA086399_A", "CA086399"],
      ["CA000046_1_C.2.1.2.1.1.1", "CA000046_1"],
      ["CM008566_A.3", "CM008566"],
      ["GF000023_scatto", "GF000023"],
      ["CD064875", "CD064875"],
    ];
    for (const [name, code] of cases) expect(codeOf(name, {}), name).toBe(code);
  });

  it("uses the sheet's mesh map first and ignores names that hold no code", () => {
    expect(codeOf("Body-3", { "Body-3": "CA064787" })).toBe("CA064787");
    expect(codeOf("Body-3", {})).toBeNull();
    expect(codeOf("3979MB assembly", {})).toBeNull();
  });
});
