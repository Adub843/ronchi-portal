import { describe, expect, it } from "vitest";
import { planPictures } from "../../web/catalog/renders";

const manifest = {
  version: 1,
  views: { iso: "view-iso.png", front: "view-front.png", back: "view-back.png" },
  parts: [
    { name: "GF000001 test plate", code: "GF000001", file: "part-GF000001_test_plate.png" },
    { name: "CA000002_A shaft", code: "CA000002", file: "part-CA000002_A_shaft.png" },
    { name: "CA000002_B shaft", file: "part-CA000002_B_shaft.png" },
    { name: "CM000003 bush", file: "part-CM000003_bush.png" },
    { name: "Bracket left", file: "part-Bracket_left.png" },
    { name: "GF999999 not in this machine", file: "part-GF999999.png" },
    { name: "GF000005 frame", file: "part-GF000005_frame.png" },
    { name: "GF000006 not drawn", file: null },
  ],
};
const files = ["manifest.json", "view-iso.png", "view-front.png", "view-back.png", "part-GF000001_test_plate.png", "part-CA000002_A_shaft.png", "part-CA000002_B_shaft.png", "part-CM000003_bush.png", "part-Bracket_left.png", "part-GF999999.png"];
const known = new Set(["GF000001", "CA000002", "CM000003", "GF000005", "GF000006"]);

describe("matching Fusion pictures to a catalog", () => {
  const plan = planPictures(manifest, files, known);

  it("gives each part number in the catalog its picture, the first one found", () => {
    expect(plan.pictures).toEqual([
      { code: "GF000001", file: "part-GF000001_test_plate.png", name: "GF000001 test plate" },
      { code: "CA000002", file: "part-CA000002_A_shaft.png", name: "CA000002_A shaft" },
      { code: "CM000003", file: "part-CM000003_bush.png", name: "CM000003 bush" },
    ]);
  });

  it("takes only the standard views that were picked", () => {
    expect(plan.views).toEqual([{ view: "iso", file: "view-iso.png" }, { view: "front", file: "view-front.png" }]);
  });

  it("says what couldn't be matched and why", () => {
    expect(plan.noCode).toEqual(["Bracket left"]);
    expect(plan.notInCatalog).toEqual(["GF999999"]);
    expect(plan.missingFiles).toEqual(["part-GF000005_frame.png"]);
  });

  it("refuses a file that isn't a Fusion pictures list", () => {
    expect(() => planPictures({ hello: 1 }, files, known)).toThrow();
    expect(() => planPictures(null, files, known)).toThrow();
  });

  it("matches file names whatever their case", () => {
    expect(planPictures(manifest, files.map((f) => f.toUpperCase()), known).pictures).toHaveLength(3);
  });
});
