import { describe, expect, it } from "vitest";
import { findAssemblies, type NamedNode } from "../../web/catalog/split";

const n = (name: string, ...children: NamedNode[]): NamedNode => ({ name, children });

describe("splitting a whole-machine 3D model onto its parts lists", () => {
  // 4011MB-like tree: the machine, its filler assembly twice (two copies), a capper inside the
  // filler, and parts that are not parts lists.
  const machine = n("4011MB",
    n("GS095008-1", n("CD088163-1"), n("GF070517-1", n("CA000096-1"))),
    n("GS095008-2", n("CD088163-1")),
    n("ELE00885-3"),
  );

  it("finds the first, outermost copy of each parts list's assembly, at any depth", () => {
    const hits = findAssemblies(machine, ["GS095008", "GF070517", "CA000096", "GS999999"]);
    expect([...hits.keys()].sort()).toEqual(["CA000096", "GF070517", "GS095008"]);
    expect(hits.get("GS095008")).toBe(machine.children[0]);
    expect(hits.get("CA000096")!.name).toBe("CA000096-1");
  });

  it("finds nothing when no parts list code is in the model", () => {
    expect(findAssemblies(machine, []).size).toBe(0);
    expect(findAssemblies(n("Body"), ["GS095008"]).size).toBe(0);
  });
});
