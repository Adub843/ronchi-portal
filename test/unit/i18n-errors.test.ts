// Server messages with a name or number in them still reach Spanish and Italian (web/src/i18n-errors.ts).
import { describe, expect, it } from "vitest";
import { ERROR_PATTERNS, ERRORS_ES, ERRORS_IT } from "../../web/src/i18n-errors";

const shape = (text: string) => ERROR_PATTERNS.find((p) => p.re.test(text));

describe("server messages", () => {
  it("every fixed message has Spanish and Italian", () => {
    for (const [en, es] of Object.entries(ERRORS_ES)) {
      expect(es, en).toBeTruthy();
      expect(ERRORS_IT[en], en).toBeTruthy();
    }
  });
  it("messages with a value filled in are recognised", () => {
    for (const m of ["Line 3 is empty.", "Job number 26-101-S1 is already used.", "Machine RA1018 is already in the registry.", "Quantity must be a number.", "Notes is too long (limit 5000 characters).", "Choose the kind of expense from the list.", "Regular hours must be between 0 and 24."]) {
      expect(shape(m), m).toBeTruthy();
    }
    expect("Line 3 is empty.".replace(shape("Line 3 is empty.")!.re, shape("Line 3 is empty.")!.es)).toBe("La línea 3 está vacía.");
  });
});
