// Instruction notes a person closes with the × (Aaron, 2026-11-24: "i want to be able to remove this
// and other instructions with a small x after reading").
import { describe, expect, it } from "vitest";
import { Browser, person } from "./helpers";

describe("closed tips", () => {
  it("are saved to each person's login, and Show tips again brings them all back", async () => {
    const tech = await person("tech");
    const sales = await person("sales");
    expect((await tech.json("/api/prefs/tips")).data.hidden).toEqual([]);
    expect((await tech.json("/api/prefs/tips", { body: { id: "people.head" } })).status).toBe(200);
    expect((await tech.json("/api/prefs/tips", { body: { id: "people.head" } })).status).toBe(200); // twice is fine
    await tech.json("/api/prefs/tips", { body: { id: "settings.look" } });
    expect((await tech.json("/api/prefs/tips")).data.hidden).toEqual(["people.head", "settings.look"]);
    // Someone else's notes are their own.
    expect((await sales.json("/api/prefs/tips")).data.hidden).toEqual([]);
    expect((await tech.json("/api/prefs/tips", { method: "DELETE" })).status).toBe(200);
    expect((await tech.json("/api/prefs/tips")).data.hidden).toEqual([]);
  });

  it("only takes short note names, and needs a sign-in", async () => {
    const p = await person("service");
    for (const id of ["", "People Head", "../x", "a".repeat(61), 5]) {
      expect((await p.json("/api/prefs/tips", { body: { id } })).status).toBe(400);
    }
    expect((await new Browser().fetch("/api/prefs/tips")).status).toBe(401);
  });
});
