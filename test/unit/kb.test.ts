import { describe, expect, it } from "vitest";
import { cleanContent, contentText, scanForCustomerData } from "../../src/shared/kb";

describe("customer-data scan", () => {
  const names = ["ALPLA", "Henkel", "Chattanooga", "L'Oreal"];

  it("finds customer and site names as whole words, in any field", () => {
    const hits = scanForCustomerData({ title: "Scroll timing at Henkel", fix: "Same fix used in chattanooga last year" }, names);
    expect(hits.map((h) => [h.found, h.field])).toEqual([["Henkel", "title"], ["Chattanooga", "fix"]]);
  });

  it("does not flag a name hidden inside another word", () => {
    expect(scanForCustomerData({ body: "Alarm 198 on the alplatform" }, names)).toEqual([]);
  });

  it("finds machine numbers, emails, phone numbers and passwords", () => {
    const hits = scanForCustomerData({ body: "On 3069MB and RA1018 call 843-555-0142 or mail paolo@ronchiamerica.com. Password: Ronchi123" }, []);
    expect(hits.map((h) => h.what)).toEqual(["Machine number", "Machine number", "Email address", "Phone number", "Password"]);
  });

  it("leaves speeds, sizes and alarm numbers alone", () => {
    expect(scanForCustomerData({ body: "Run at 2400RPM, 1500 mm rail, 480V supply, Alarm 198, parameter 1022." }, [])).toEqual([]);
  });
});

describe("article layout", () => {
  it("keeps steps, tables and notes, drops photos, and reads as plain text", () => {
    const c = cleanContent({
      meta: { Machine: "EXACTA-R capper" },
      safety: ["Lock out the machine."],
      blocks: [
        { heading: "Procedure", steps: [{ title: "Remove the gearbox", text: ["Remove the retaining bolt."], img: "s0/media/image4.png", callouts: [{ kind: "note", label: "Refit", text: "Check the key for wear." }] }] },
        { heading: "Troubleshooting", table: { cols: ["Symptom", "Fix"], rows: [["Pump turns sideways", "Close up the rail."]] } },
        { img: "only-a-photo.png" },
      ],
    });
    expect(JSON.stringify(c)).not.toContain("img");
    expect(c.blocks).toHaveLength(2);
    expect(contentText(c)).toBe(
      "Safety\n• Lock out the machine.\n\nProcedure\n1. Remove the gearbox\n   Remove the retaining bolt.\n   Refit: Check the key for wear.\n\nTroubleshooting\nSymptom | Fix\nPump turns sideways | Close up the rail.",
    );
  });
});

describe("scan wording", () => {
  it("talks about passwords without flagging them, but flags a written-down password", () => {
    expect(scanForCustomerData({ body: "Ask the service lead for the passwords (each panel has its own password)." }, [])).toEqual([]);
    expect(scanForCustomerData({ body: "The panel password is 1234" }, []).map((h) => h.what)).toEqual(["Password"]);
  });
});
