import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { person } from "./helpers";

describe("message boards", () => {
  it("anyone on staff can create a board, post, and reply", async () => {
    const tech = await person("tech");
    const eng = await person("engineering");
    const { data } = await tech.json("/api/boards", { body: { name: "3069MB capper", description: "Torque drift" } });
    await tech.json(`/api/boards/${data.id}/posts`, { body: { body: "Torque drifts after 2 hours." } });
    const board = await eng.json(`/api/boards/${data.id}`);
    expect(board.data.posts).toHaveLength(1);
    const reply = await eng.json(`/api/boards/${data.id}/posts`, { body: { body: "Check the clutch.", parentId: board.data.posts[0].id } });
    expect(reply.status).toBe(200);
  });

  it("a board limited to some roles is invisible to everyone else", async () => {
    const sales = await person("sales");
    const tech = await person("tech");
    const { data } = await sales.json("/api/boards", { body: { name: "Quotes", audience: ["sales"] } });
    expect((await tech.fetch(`/api/boards/${data.id}`)).status).toBe(404);
    const list = await tech.json("/api/boards");
    expect(list.data.boards.some((b: any) => b.id === data.id)).toBe(false);
    expect((await (await person("admin")).fetch(`/api/boards/${data.id}`)).status).toBe(200);
  });

  it("stores messages as plain text exactly as typed", async () => {
    const tech = await person("tech");
    const { data } = await tech.json("/api/boards", { body: { name: "Text test" } });
    const evil = `<img src=x onerror="alert(1)">`;
    await tech.json(`/api/boards/${data.id}/posts`, { body: { body: evil } });
    expect((await tech.json(`/api/boards/${data.id}`)).data.posts[0].body).toBe(evil);
  });

  it("people can only remove their own messages unless they moderate", async () => {
    const a = await person("tech");
    const b = await person("sales");
    const { data } = await a.json("/api/boards", { body: { name: "Mine" } });
    const post = await a.json(`/api/boards/${data.id}/posts`, { body: { body: "hello" } });
    expect((await b.fetch(`/api/boards/${data.id}/posts/${post.data.id}`, { method: "DELETE" })).status).toBe(403);
    expect((await a.fetch(`/api/boards/${data.id}/posts/${post.data.id}`, { method: "DELETE" })).status).toBe(200);
  });
});

describe("machine registry", () => {
  it("adds a machine and finds it by number or customer", async () => {
    const steve = await person("service");
    const r = await steve.json("/api/machines", { body: { serial: "3069mb", model: "Monoblock", customer: "Acme Labs", site: "Ohio" } });
    expect(r.status).toBe(200);
    const sales = await person("sales");
    expect((await sales.json("/api/machines?q=3069")).data.machines[0].serial).toBe("3069MB");
    expect((await sales.json("/api/machines?q=acme")).data.machines).toHaveLength(1);
    expect((await steve.fetch("/api/machines", { body: { serial: "3069MB" } })).status).toBe(409);
    expect((await steve.fetch("/api/machines", { body: { serial: "hello" } })).status).toBe(400);
  });
});

describe("time clock", () => {
  it("clocks in and out with phone location, using the server's time", async () => {
    const tech = await person("tech");
    const before = Date.now();
    const a = await tech.json("/api/clock/punch", { body: { kind: "in", lat: 32.7765123, lng: -79.9311456, accuracy: 12 } });
    expect(a.status).toBe(200);
    expect(Date.parse(a.data.at)).toBeGreaterThanOrEqual(before - 1000);
    expect((await tech.fetch("/api/clock/punch", { body: { kind: "in" } })).status).toBe(409);
    expect((await tech.json("/api/clock/punch", { body: { kind: "out", lat: 32.77, lng: -79.93 } })).status).toBe(200);
    const row = await env.DB.prepare("SELECT lat, location_source FROM punches WHERE id = ?").bind(a.data.id).first<{ lat: number; location_source: string }>();
    expect(row).toEqual({ lat: 32.77651, location_source: "gps" });
  });

  it("only people with the option can type an address", async () => {
    const tech = await person("tech");
    expect((await tech.fetch("/api/clock/punch", { body: { kind: "in", address: "123 Main St" } })).status).toBe(403);
    const aaron = await person("tech", { canTypeAddress: true });
    const r = await aaron.json("/api/clock/punch", { body: { kind: "in", address: "Plant 2, Charleston SC" } });
    expect(r.data.location).toBe("typed");
  });

  it("a time change needs someone else's approval, and the original time is kept", async () => {
    const lola = await person("billing");
    const tech = await person("tech");
    const p = await tech.json("/api/clock/punch", { body: { kind: "in" } });
    const newAt = new Date(Date.now() - 3600_000).toISOString();
    const req = await tech.json(`/api/clock/punches/${p.data.id}/edit`, { body: { newAt, reason: "Forgot to clock in" } });
    expect(req.status).toBe(200);
    // Lola can't approve her own; the tech can't approve at all.
    expect((await tech.fetch(`/api/clock/edits/${req.data.id}/decide`, { body: { approve: true } })).status).toBe(403);
    expect((await lola.fetch(`/api/clock/edits/${req.data.id}/decide`, { body: { approve: true } })).status).toBe(200);
    const punch = await env.DB.prepare("SELECT at FROM punches WHERE id = ?").bind(p.data.id).first<{ at: string }>();
    expect(punch?.at).toBe(newAt);
    const edit = await env.DB.prepare("SELECT old_at, status FROM punch_edits WHERE id = ?").bind(req.data.id).first<{ old_at: string; status: string }>();
    expect(edit?.status).toBe("approved");
    expect(edit?.old_at).not.toBe(newAt);
  });

  it("exports hours as a spreadsheet-safe CSV", async () => {
    const lola = await person("billing");
    const tech = await person("tech", { name: "=HYPERLINK(evil)" });
    await tech.json("/api/clock/punch", { body: { kind: "in" } });
    await tech.json("/api/clock/punch", { body: { kind: "out" } });
    const res = await lola.fetch("/api/clock/hours/export?format=csv&kind=punches");
    expect(res.headers.get("content-type")).toContain("text/csv");
    const text = await res.text();
    expect(text).toContain("'=HYPERLINK(evil)");
    expect(text).not.toMatch(/(^|,)=HYPERLINK/m);
  });
});

describe("personal look", () => {
  it("saves theme and layout to the login, and Reset goes back to Ronchi", async () => {
    const p = await person("tech");
    expect((await p.json("/api/prefs")).data.theme).toBe("ronchi");
    expect((await p.json("/api/prefs", { method: "PUT", body: { theme: "T7", mode: "dark", layout: "L2" } })).data.theme).toBe("T7");
    expect((await p.json("/api/prefs")).data).toMatchObject({ theme: "T7", mode: "dark" });
    expect((await p.fetch("/api/prefs", { method: "PUT", body: { theme: "T99" } })).status).toBe(400);
    expect((await p.json("/api/prefs", { method: "PUT", body: { reset: true } })).data.theme).toBe("ronchi");
  });
});

describe("audit log", () => {
  it("can't be changed or deleted, even directly in the database", async () => {
    await person("tech");
    await expect(env.DB.prepare("DELETE FROM audit_log").run()).rejects.toThrow(/append-only/);
    await expect(env.DB.prepare("UPDATE audit_log SET action = 'x'").run()).rejects.toThrow(/append-only/);
  });
});
