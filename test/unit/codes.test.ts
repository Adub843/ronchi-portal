import { describe, expect, it } from "vitest";
import { codeOf, listedCode } from "../../web/catalog/codes";

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

describe("finding a list code in a name the 3D loader squeezed", () => {
  // three.js drops dots from node names, so Creo's "CD075732.1" arrives as "CD0757321".
  const known = new Set(["CD075732", "CD085377", "CM009451_36", "CA000046", "CM006026_1", "CM006026_2"]);
  it("reads the list code when copy numbers were glued on", () => {
    expect(listedCode("CD0757321", known)).toBe("CD075732");
    expect(listedCode("CD0757321_2", known)).toBe("CD075732");
    expect(listedCode("CD085377111", known)).toBe("CD085377");
    expect(listedCode("CA000046", known)).toBe("CA000046");
  });
  it("uses a list code with a suffix when the name has only its base and one row fits", () => {
    expect(listedCode("CM00945111", known)).toBe("CM009451_36");
    expect(listedCode("CM006026", known)).toBeNull();
  });
  it("never reads a code that is not on the list, or one cut from a longer number", () => {
    expect(listedCode("CD0757", known)).toBeNull();
    expect(listedCode("CD07573211111", known)).toBeNull();
    expect(listedCode("flangia", known)).toBeNull();
    expect(listedCode("XCD075732", known)).toBeNull();
  });
});

describe("list codes with CAD file suffixes", () => {
  it("reads CD058040PRT and CD056980ipt", () => {
    const known = new Set(["CD058040", "CD056980"]);
    expect(listedCode("CD058040PRT", known)).toBe("CD058040");
    expect(listedCode("CD056980ipt", known)).toBe("CD056980");
    expect(listedCode("CD058040PRTX", known)).toBeNull();
  });
});
