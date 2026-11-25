import { describe, expect, it } from "vitest";
import { readStepTree, regroup, type StepNode } from "../../web/catalog/steptree";
import { findAssemblies } from "../../web/catalog/split";

// A cut-down STEP file shaped like Creo's 4071.stp: a machine, a sub-assembly (GF083234) holding
// two parts, and a part used straight under the machine.
const STEP = `ISO-10303-21;
HEADER;
FILE_NAME('4071.stp','2023-03-20',(''),(''),'','','');
ENDSEC;
DATA;
#10=PRODUCT('4071_carico_tappi.1','4071_carico_tappi.1','',(#1));
#11=PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE('','',#10,.NOT_KNOWN.);
#12=PRODUCT_DEFINITION('design','',#11,#2);
#20=PRODUCT('GF083234','GF083234','',(#1));
#21=PRODUCT_DEFINITION_FORMATION('','',#20);
#22=PRODUCT_DEFINITION('design','',#21,#2);
#30=PRODUCT('CD027709_1_A.5','CD027709_1_A.5','',(#1));
#31=PRODUCT_DEFINITION_FORMATION('','',#30);
#32=PRODUCT_DEFINITION('design','',#31,#2);
#40=PRODUCT('VITE_UNI_5739_M8x20','it''s a screw','',(#1));
#41=PRODUCT_DEFINITION_FORMATION('','',#40);
#42=PRODUCT_DEFINITION('design','',
  #41,#2);
#50=NEXT_ASSEMBLY_USAGE_OCCURRENCE('1','','',#12,#22,$);
#51=NEXT_ASSEMBLY_USAGE_OCCURRENCE('2','','',#22,#32,$);
#52=NEXT_ASSEMBLY_USAGE_OCCURRENCE('3','','',#22,#42,$);
#53=NEXT_ASSEMBLY_USAGE_OCCURRENCE('4','','',#12,#42,$);
ENDSEC;
END-ISO-10303-21;
`;
const bytes = (s: string) => new TextEncoder().encode(s);
type T = { name: string; children: T[] };
const names = (t: T): unknown => (t.children.length ? [t.name, t.children.map(names)] : t.name);

describe("reading the assembly tree from a STEP file", () => {
  it("gives every use of every assembly and part, in file order", () => {
    expect(names(readStepTree(bytes(STEP))!)).toEqual([
      "4071_carico_tappi.1",
      [["GF083234", ["CD027709_1_A.5", "VITE_UNI_5739_M8x20"]], "VITE_UNI_5739_M8x20"],
    ]);
  });

  it("reads entities that straddle the chunks it reads the file in", () => {
    expect(names(readStepTree(bytes(STEP), 37)!)).toEqual(names(readStepTree(bytes(STEP))!));
  });

  it("gives nothing for a file with no assemblies", () => {
    expect(readStepTree(bytes("ISO-10303-21;\nDATA;\nENDSEC;"))).toBeNull();
  });
});

describe("putting the 3D reader's flattened parts back into their sub-assemblies", () => {
  // What occt-import-js gives for such a file: the top two levels, with every part further down
  // flattened onto CARICO-TAPPI.1.
  const occt = { name: "", meshes: [], children: [
    { name: "4071_carico_tappi.1", meshes: [], children: [
      { name: "CARICO-TAPPI.1", meshes: [0, 1, 2, 3, 4], children: [] },
    ] },
  ] };
  const meshNames = ["CD027709_1_A.5", "VITE", "VITE", "VITE", "Body-7"];
  const n = (name: string, ...children: StepNode[]): StepNode => ({ name, children });
  const step = n("4071_carico_tappi.1",
    n("CARICO-TAPPI.1",
      n("GF083234", n("CD027709_1_A.5"), n("VITE")),
      n("VITE"),
      n("CA086399_A.1", n("VITE")),
    ),
  );

  it("gives each part back to the sub-assembly it belongs to, so its parts list can be found", () => {
    const tree = regroup(occt, meshNames, step);
    const carico = tree.children[0]!.children[0]!;
    expect(carico.name).toBe("CARICO-TAPPI.1");
    expect(carico.meshes).toEqual([2, 4]);
    expect(carico.children.map((c) => [c.name, c.meshes])).toEqual([["GF083234", [0, 1]], ["CA086399_A.1", [3]]]);
    expect([...findAssemblies(tree, ["GF083234", "CA086399"]).keys()].sort()).toEqual(["CA086399", "GF083234"]);
  });

  it("leaves the 3D reader's tree as it is when the STEP tree doesn't fit it", () => {
    expect(regroup(occt, meshNames, n("Other machine", n("X")))).toEqual(occt);
  });
});
