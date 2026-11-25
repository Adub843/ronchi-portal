// The portal training center (web/src/learn). These tests keep it honest as the portal grows:
// every permission has a guide, every menu page has a training area, and every guide is in
// English, Spanish and Italian.
import { describe, expect, it } from "vitest";
import { AREAS, GUIDES, guidesFor, rolesThatCan } from "../../web/src/learn/guides";

describe("who sees which guides", () => {
  it("someone with no permissions still gets the basics, and nothing that needs access", () => {
    const ids = guidesFor([]).map((g) => g.id);
    expect(ids).toContain("sign-in");
    expect(ids).toContain("add-device");
    expect(ids).not.toContain("start-chat");
    expect(ids).not.toContain("invite-employee");
  });

  it("a guide shows only when the person has every switch it needs", () => {
    // Sending photos needs both "use chats" and "send files".
    expect(guidesFor(["boards.use"]).map((g) => g.id)).not.toContain("send-files");
    expect(guidesFor(["files.send"]).map((g) => g.id)).not.toContain("send-files");
    expect(guidesFor(["boards.use", "files.send"]).map((g) => g.id)).toContain("send-files");
  });

  it("lists the roles that can follow a guide, from each role's real switches", () => {
    const roles = [
      { id: "admin", name: "Admin", perms: ["boards.use", "files.send", "orders.view"] },
      { id: "tech", name: "Field service engineer", perms: ["boards.use"] },
      { id: "r-ship", name: "Shipping", perms: ["boards.use", "files.send"] },
    ];
    const send = GUIDES.find((g) => g.id === "send-files")!;
    expect(rolesThatCan(send, roles).map((r) => r.id)).toEqual(["admin", "r-ship"]);
    const signIn = GUIDES.find((g) => g.id === "sign-in")!;
    expect(rolesThatCan(signIn, roles)).toHaveLength(3);
  });
});

describe("the training covers the whole portal", () => {
  it("every permission is taught by at least one guide", async () => {
    const { PERMISSION_GROUPS } = await import("../../src/portal/lib/roles");
    const taught = new Set(GUIDES.flatMap((g) => g.needs));
    const all = PERMISSION_GROUPS.flatMap((g) => g.perms.map((p) => p.id));
    expect(all.filter((p) => !taught.has(p))).toEqual([]);
  });

  it("every guide needs only real permissions", async () => {
    const { isPermission } = await import("../../src/portal/lib/roles");
    expect(GUIDES.flatMap((g) => g.needs).filter((p) => !isPermission(p))).toEqual([]);
  });

  it("every page in the menu has a training area, and every guide belongs to an area", async () => {
    const { NAV } = await import("../../web/src/nav");
    const paths = new Set(AREAS.flatMap((a) => a.paths));
    expect(NAV.map((n) => n.to).filter((p) => !paths.has(p))).toEqual([]);
    const areaIds = new Set(AREAS.map((a) => a.id));
    expect(GUIDES.filter((g) => !areaIds.has(g.area)).map((g) => g.id)).toEqual([]);
  });

  it("guide ids are unique", () => {
    const ids = GUIDES.map((g) => g.id);
    expect(ids.length).toBe(new Set(ids).size);
  });
});

describe("guides in every language", () => {
  it("every title, summary, step and tip has English, Spanish and Italian", () => {
    const missing: string[] = [];
    const check = (where: string, x: { en: string; es: string; it: string } | undefined) => {
      if (!x) return;
      for (const l of ["en", "es", "it"] as const) if (!x[l]?.trim()) missing.push(`${where} (${l})`);
    };
    for (const a of AREAS) { check(`area ${a.id} title`, a.title); check(`area ${a.id} blurb`, a.blurb); }
    for (const g of GUIDES) {
      check(`${g.id} title`, g.title);
      check(`${g.id} summary`, g.summary);
      g.steps.forEach((s, i) => check(`${g.id} step ${i + 1}`, s));
      check(`${g.id} tip`, g.tip);
      if (!g.steps.length) missing.push(`${g.id} has no steps`);
    }
    expect(missing).toEqual([]);
  });

  it("says field service engineer, never tech or technician (or técnico / tecnico)", () => {
    const words = JSON.stringify([AREAS, GUIDES]);
    expect(words).not.toMatch(/\btech(s|nician|nicians)?\b|t[ée]cnic/i);
  });
});
