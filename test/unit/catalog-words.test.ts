import { describe, expect, it } from "vitest";
import { w, WORDS } from "../../web/catalog/words";

describe("catalog viewer words", () => {
  it("every word has Spanish and Italian with the same blanks", () => {
    const blanks = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
    for (const [en, [es, it]] of Object.entries(WORDS)) {
      expect(es.trim(), en).not.toBe("");
      expect(it.trim(), en).not.toBe("");
      expect(blanks(es), en).toBe(blanks(en));
      expect(blanks(it), en).toBe(blanks(en));
    }
  });
  it("fills blanks", () => {
    expect(w("it", "{n} parts", { n: 3 })).toBe("3 ricambi");
  });
});
