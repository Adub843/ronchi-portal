import { describe, expect, it } from "vitest";
// @ts-expect-error plain JavaScript helper
import { texts } from "../../scripts/i18n-strings.mjs";
import { DYNAMIC, ES, IT } from "../../web/src/i18n-dict";

describe("languages", () => {
  const all: string[] = [...texts("web/src"), ...DYNAMIC];
  it("every text on screen has Spanish and Italian", () => {
    expect(all.length).toBeGreaterThan(150);
    expect(all.filter((s) => !ES[s])).toEqual([]);
    expect(all.filter((s) => !IT[s])).toEqual([]);
  });
  it("keeps every {blank} in the translations", () => {
    const blanks = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
    for (const s of all) {
      expect(blanks(ES[s]!), s).toBe(blanks(s));
      expect(blanks(IT[s]!), s).toBe(blanks(s));
    }
  });
});

describe("access screen words", () => {
  it("every permission name, hint and group is translated", async () => {
    const { PERMISSION_GROUPS } = await import("../../src/portal/lib/roles");
    const words = PERMISSION_GROUPS.flatMap((g) => [g.group, ...g.perms.flatMap((p) => [p.label, p.hint])]);
    expect(words.filter((w) => !DYNAMIC.includes(w) || !ES[w] || !IT[w])).toEqual([]);
  });
});
