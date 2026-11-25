import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import { forgetSettings } from "../../src/portal/lib/settings-store";
import { person } from "./helpers";

// Each test starts from the built-in settings.
afterEach(async () => {
  await env.DB.prepare("DELETE FROM settings").run();
  forgetSettings();
});

describe("Settings > Admin controls", () => {
  it("only admins can read or change them", async () => {
    for (const role of ["tech", "sales", "billing", "scheduling", "service", "engineering"]) {
      const p = await person(role);
      expect((await p.fetch("/api/settings")).status, role).toBe(403);
      expect((await p.fetch("/api/settings", { method: "PUT", body: { brand: { name: "Hacked" } } })).status, role).toBe(403);
      expect((await p.fetch("/api/settings/sign-out-everyone", { body: { confirm: "SIGN OUT" } })).status, role).toBe(403);
      expect((await p.fetch("/api/settings/stats")).status, role).toBe(403);
    }
    const admin = await person("admin");
    const r = await admin.json("/api/settings");
    expect(r.status).toBe(200);
    expect(r.data.settings.chats.maxPeople).toBe(30);
  });

  it("saves, records who changed what, and shows the name and notice to everyone signed in", async () => {
    const admin = await person("admin");
    const r = await admin.json("/api/settings", { method: "PUT", body: { brand: { name: "Ronchi Hub", notice: "Portal down Sat 8-9 AM" } } });
    expect(r.status).toBe(200);
    expect(r.data.settings.brand).toEqual({ name: "Ronchi Hub", company: "Ronchi America", notice: "Portal down Sat 8-9 AM" });
    const tech = await person("tech");
    expect((await tech.json("/api/auth/me")).data.settings.brand.notice).toBe("Portal down Sat 8-9 AM");
    const log = await admin.json("/api/users/audit/recent");
    const entry = log.data.entries.find((e: any) => e.action === "settings.update");
    expect(JSON.parse(entry.detail)["brand.name"]).toEqual(["Ronchi Portal", "Ronchi Hub"]);
  });

  it("refuses values out of range and keeps what was saved", async () => {
    const admin = await person("admin");
    for (const bad of [
      { chats: { maxFileMb: 100 } }, // 25 MB is the hard ceiling
      { chats: { maxPeople: 1 } },
      { people: { sessionDays: 5, idleDays: 10 } },
      { people: { defaultRole: "admin" } },
      { languages: { allowed: ["en"], default: "es" } },
      { brand: { name: "" } },
    ]) {
      expect((await admin.fetch("/api/settings", { method: "PUT", body: bad })).status, JSON.stringify(bad)).toBe(400);
    }
    expect((await admin.json("/api/settings")).data.settings.chats.maxFileMb).toBe(25);
  });

  it("hard rule: managers and other roles never get the admin controls, and admins keep everything", async () => {
    const admin = await person("admin");
    const manager = await person("manager");
    expect((await manager.fetch("/api/settings")).status).toBe(403);
    expect((await admin.fetch("/api/settings", { method: "PUT", body: { roles: { tech: ["settings.manage"] } } })).status).toBe(200); // roles aren't set here; ignored
    await admin.json("/api/settings", { method: "PUT", body: { sections: { chats: false, machines: false, catalog: false, customers: false, changeParts: false, knowledge: false } } });
    expect((await admin.fetch("/api/machines")).status).toBe(200);
    expect((await admin.fetch("/api/settings")).status).toBe(200);
    expect((await manager.fetch("/api/machines")).status).toBe(403);
  });

  it("turning a section off hides it from everyone but admins", async () => {
    const admin = await person("admin");
    const sales = await person("sales");
    expect((await sales.fetch("/api/change-parts")).status).toBe(200);
    await admin.json("/api/settings", { method: "PUT", body: { sections: { changeParts: false } } });
    expect((await sales.fetch("/api/change-parts")).status).toBe(403);
    expect((await admin.fetch("/api/change-parts")).status).toBe(200);
    await admin.json("/api/settings/reset", { body: { group: "sections" } });
    expect((await sales.fetch("/api/change-parts")).status).toBe(200);
  });

  it("chat limits: people per chat, and the switch for files", async () => {
    const admin = await person("admin");
    const tech = await person("tech");
    await admin.json("/api/settings", { method: "PUT", body: { chats: { maxPeople: 2, files: false } } });
    const a = await person("tech");
    const b = await person("tech");
    expect((await tech.fetch("/api/boards/chats", { body: { userIds: [a.id, b.id] } })).status).toBe(400);
    const chat = await tech.json("/api/boards/chats", { body: { userIds: [a.id] } });
    expect(chat.status).toBe(200);
    const form = new FormData();
    form.append("body", "photo");
    form.append("files", new File([new Uint8Array(10)], "pic.png", { type: "image/png" }));
    expect((await tech.form(`/api/boards/${chat.data.id}/posts`, form)).status).toBe(403);
  });

  it("pausing invites stops new invite links", async () => {
    const admin = await person("admin");
    await admin.json("/api/settings", { method: "PUT", body: { people: { invitesPaused: true } } });
    expect((await admin.fetch("/api/users/invite", { body: { email: "newbie", name: "New Person", role: "tech" } })).status).toBe(403);
  });

  it("invite links last as long as the setting says", async () => {
    const admin = await person("admin");
    await admin.json("/api/settings", { method: "PUT", body: { people: { inviteHours: 24 } } });
    await admin.json("/api/users/invite", { body: { email: "dayone", name: "Day One", role: "tech" } });
    const inv = (await admin.json("/api/users")).data.invites.find((i: any) => i.email === "dayone");
    const hours = (Date.parse(inv.expires_at) - Date.now()) / 3600_000;
    expect(hours).toBeGreaterThan(23.9);
    expect(hours).toBeLessThan(24.1);
  });

  it("shortening sign-in length signs out people signed in longer than that", async () => {
    const admin = await person("admin");
    const tech = await person("tech");
    await env.DB.prepare("UPDATE sessions SET created_at = ? WHERE user_id = ?").bind(new Date(Date.now() - 3 * 86400_000).toISOString(), tech.id).run();
    await admin.json("/api/settings", { method: "PUT", body: { people: { sessionDays: 2, idleDays: 1 } } });
    expect((await tech.json("/api/auth/me")).data.user).toBeNull();
    expect((await admin.json("/api/auth/me")).data.user).not.toBeNull();
  });

  it("languages and looks people can pick, and what new people start with", async () => {
    const admin = await person("admin");
    await admin.json("/api/settings", { method: "PUT", body: { languages: { allowed: ["en", "es"], default: "es" }, look: { allowedThemes: ["ronchi", "T2"], defaultTheme: "T2", popupsDefault: false } } });
    const tech = await person("tech");
    const p = await tech.json("/api/prefs");
    expect(p.data).toMatchObject({ theme: "T2", lang: "es", popups: false });
    expect((await tech.fetch("/api/prefs", { method: "PUT", body: { theme: "T3", lang: "en" } })).status).toBe(400);
    expect((await tech.fetch("/api/prefs", { method: "PUT", body: { theme: "ronchi", lang: "it" } })).status).toBe(400);
    expect((await tech.fetch("/api/prefs", { method: "PUT", body: { theme: "ronchi", lang: "en" } })).status).toBe(200);
  });

  it("emergency sign-out ends every other device but keeps the admin signed in", async () => {
    const admin = await person("admin");
    const tech = await person("tech");
    expect((await admin.fetch("/api/settings/sign-out-everyone", { body: {} })).status).toBe(400);
    const r = await admin.json("/api/settings/sign-out-everyone", { body: { confirm: "SIGN OUT" } });
    expect(r.data.sessions).toBeGreaterThan(0);
    expect((await tech.json("/api/auth/me")).data.user).toBeNull();
    expect((await admin.json("/api/auth/me")).data.user).not.toBeNull();
  });

  it("a section turned off stays off even for someone given that permission personally", async () => {
    const admin = await person("admin");
    const tech = await person("tech");
    expect((await admin.fetch(`/api/users/${tech.id}/access`, { method: "PUT", body: { changes: { "orders.view": true } } })).status).toBe(200);
    expect((await tech.fetch("/api/change-parts")).status).toBe(200);
    await admin.json("/api/settings", { method: "PUT", body: { sections: { changeParts: false } } });
    expect((await tech.fetch("/api/change-parts")).status).toBe(403);
  });

  it("usage numbers for growing the portal, with no money amounts", async () => {
    const admin = await person("admin");
    const r = await admin.json("/api/settings/stats");
    expect(r.status).toBe(200);
    expect(r.data.active).toBeGreaterThan(0);
    expect(JSON.stringify(r.data)).not.toMatch(/price|amount|total|\$/i);
  });
});
