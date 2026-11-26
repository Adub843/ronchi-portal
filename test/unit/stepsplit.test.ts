import { describe, expect, it } from "vitest";
import { cutStep, indexStep, kindOf, refsOf } from "../../web/catalog/stepsplit";
import { readStepTree } from "../../web/catalog/steptree";

// A machine (#12) holding a sub-assembly (#22, "GF083234") with one part (#32), and a second part
// (#42) straight under the machine. Each part has a shape; the sub-assembly places its part with a
// transformation; one part has a colour.
const STEP = `ISO-10303-21;
HEADER;
FILE_NAME('m.stp','2023-03-20',(''),(''),'','','');
ENDSEC;
DATA;
#1=APPLICATION_CONTEXT('x');
#2=PRODUCT_DEFINITION_CONTEXT('part definition',#1,'design');
#3=(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.));
#4=(GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNIT_ASSIGNED_CONTEXT((#3)) REPRESENTATION_CONTEXT('',''));
#10=PRODUCT('MACHINE','MACHINE','',(#1));
#11=PRODUCT_DEFINITION_FORMATION('','',#10);
#12=PRODUCT_DEFINITION('design','',#11,#2);
#13=PRODUCT_DEFINITION_SHAPE('','',#12);
#14=SHAPE_REPRESENTATION('',(#5),#4);
#15=SHAPE_DEFINITION_REPRESENTATION(#13,#14);
#5=AXIS2_PLACEMENT_3D('',#6,$,$);
#6=CARTESIAN_POINT('',(0.,0.,0.));
#20=PRODUCT('GF083234','GF083234; a ''quoted'' name #99','',(#1));
#21=PRODUCT_DEFINITION_FORMATION('','',#20);
#22=PRODUCT_DEFINITION('design','',#21,#2);
#23=PRODUCT_DEFINITION_SHAPE('','',#22);
#24=SHAPE_REPRESENTATION('',(#7),#4);
#25=SHAPE_DEFINITION_REPRESENTATION(#23,#24);
#7=AXIS2_PLACEMENT_3D('',#8,$,$);
#8=CARTESIAN_POINT('',(10.,0.,0.));
#30=PRODUCT('CD027709','CD027709','',(#1));
#31=PRODUCT_DEFINITION_FORMATION('','',#30);
#32=PRODUCT_DEFINITION('design','',#31,#2);
#33=PRODUCT_DEFINITION_SHAPE('','',#32);
#34=SHAPE_REPRESENTATION('',(#7),#4);
#35=SHAPE_DEFINITION_REPRESENTATION(#33,#34);
#36=ADVANCED_BREP_SHAPE_REPRESENTATION('',(#37),#4);
#37=MANIFOLD_SOLID_BREP('',#38);
#38=CLOSED_SHELL('',());
#39=SHAPE_REPRESENTATION_RELATIONSHIP('','',#34,#36);
#40=PRODUCT('SCREW','SCREW','',(#1));
#41=PRODUCT_DEFINITION_FORMATION('','',#40);
#42=PRODUCT_DEFINITION('design','',
  #41,#2);
#43=PRODUCT_DEFINITION_SHAPE('','',#42);
#44=SHAPE_REPRESENTATION('',(#5),#4);
#45=SHAPE_DEFINITION_REPRESENTATION(#43,#44);
#46=ADVANCED_BREP_SHAPE_REPRESENTATION('',(#47),#4);
#47=MANIFOLD_SOLID_BREP('',#48);
#48=CLOSED_SHELL('',());
#49=SHAPE_REPRESENTATION_RELATIONSHIP('','',#44,#46);
#50=NEXT_ASSEMBLY_USAGE_OCCURRENCE('1','','',#12,#22,$);
#51=PRODUCT_DEFINITION_SHAPE('','',#50);
#52=(REPRESENTATION_RELATIONSHIP('','',#24,#14) REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION(#53) SHAPE_REPRESENTATION_RELATIONSHIP());
#53=ITEM_DEFINED_TRANSFORMATION('','',#7,#5);
#54=CONTEXT_DEPENDENT_SHAPE_REPRESENTATION(#52,#51);
#60=NEXT_ASSEMBLY_USAGE_OCCURRENCE('2','','',#22,#32,$);
#61=PRODUCT_DEFINITION_SHAPE('','',#60);
#62=(REPRESENTATION_RELATIONSHIP('','',#34,#24) REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION(#63) SHAPE_REPRESENTATION_RELATIONSHIP());
#63=ITEM_DEFINED_TRANSFORMATION('','',#7,#7);
#64=CONTEXT_DEPENDENT_SHAPE_REPRESENTATION(#62,#61);
#70=NEXT_ASSEMBLY_USAGE_OCCURRENCE('3','','',#12,#42,$);
#71=PRODUCT_DEFINITION_SHAPE('','',#70);
#72=(REPRESENTATION_RELATIONSHIP('','',#44,#14) REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION(#73) SHAPE_REPRESENTATION_RELATIONSHIP());
#73=ITEM_DEFINED_TRANSFORMATION('','',#5,#5);
#74=CONTEXT_DEPENDENT_SHAPE_REPRESENTATION(#72,#71);
#80=COLOUR_RGB('',1.,0.,0.);
#81=STYLED_ITEM('',(#80),#37);
#82=STYLED_ITEM('',(#80),#47);
#83=MECHANICAL_DESIGN_GEOMETRIC_PRESENTATION_REPRESENTATION('',(#81,#82),#4);
ENDSEC;
END-ISO-10303-21;
`;
const bytes = (s: string) => new TextEncoder().encode(s);
const text = (b: Uint8Array) => new TextDecoder("latin1").decode(b);
const ids = (s: string) => [...s.matchAll(/^#(\d+)=/gm)].map((m) => Number(m[1])).sort((a, b) => a - b);

describe("reading a STEP file into an index", () => {
  it("keeps every entity, including ones over several lines and with ; or # inside strings", () => {
    const index = indexStep(bytes(STEP));
    expect(index.entities.size).toBe(ids(STEP).length);
    expect(index.entities.get("20")).toBe("PRODUCT('GF083234','GF083234; a ''quoted'' name #99','',(#1))");
    expect(refsOf(index.entities.get("20")!)).toEqual(["1"]);
    expect(kindOf(index.entities.get("52"))).toBe("REPRESENTATION_RELATIONSHIP");
  });

  it("reads entities that straddle the chunks it reads the file in", () => {
    const small = indexStep(bytes(STEP), 29);
    expect([...small.entities]).toEqual([...indexStep(bytes(STEP)).entities]);
  });
});

describe("cutting one assembly out of a STEP file", () => {
  const index = indexStep(bytes(STEP));

  it("keeps the assembly, everything under it, and their shapes, placements and units", () => {
    const cut = text(cutStep(index, "22")!);
    const kept = ids(cut);
    // The sub-assembly and its part, the use of the part inside it with its placement, the part's solid.
    for (const id of [22, 23, 24, 25, 32, 33, 34, 35, 36, 37, 39, 60, 61, 62, 63, 64, 3, 4]) expect(kept).toContain(id);
    // Nothing from above it: not the machine, not the use of it in the machine, not the other part.
    for (const id of [12, 13, 15, 50, 51, 52, 54, 42, 47, 70, 74]) expect(kept).not.toContain(id);
    expect(cut.startsWith("ISO-10303-21;\nHEADER;")).toBe(true);
    expect(cut.endsWith("ENDSEC;\nEND-ISO-10303-21;\n")).toBe(true);
  });

  it("is a file whose assembly tree is just that assembly", () => {
    const tree = readStepTree(cutStep(index, "22")!);
    expect(tree?.name).toBe("GF083234");
    expect(tree?.children.map((c) => c.name)).toEqual(["CD027709"]);
  });

  it("keeps only the colours of the kept shapes, under a presentation of their own", () => {
    const cut = text(cutStep(index, "22")!);
    expect(ids(cut)).toContain(81);
    expect(ids(cut)).not.toContain(82);
    expect(ids(cut)).not.toContain(83);
    expect(cut).toMatch(/#84=MECHANICAL_DESIGN_GEOMETRIC_PRESENTATION_REPRESENTATION\('',\(#81\),#4\);/);
  });

  it("cuts a single part too", () => {
    const kept = ids(text(cutStep(index, "42")!));
    expect(kept).toEqual(expect.arrayContaining([42, 43, 44, 45, 46, 47, 49]));
    expect(kept).not.toContain(70);
  });

  it("gives null for an id that isn't a PRODUCT_DEFINITION", () => {
    expect(cutStep(index, "10")).toBeNull();
    expect(cutStep(index, "999")).toBeNull();
  });

  it("gives every node of the assembly tree its definition id", () => {
    const tree = readStepTree(bytes(STEP))!;
    expect(tree.def).toBe("12");
    expect(tree.children.map((c) => c.def)).toEqual(["22", "42"]);
  });
});
