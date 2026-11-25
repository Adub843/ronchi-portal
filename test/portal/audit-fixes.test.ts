// Fixes from the 2026-11-25 portal audit that this branch carries (machine edits, job files with chats
// off). Each test is the failing scenario the audit found.
import { describe, expect, it } from "vitest";
import { person } from "./helpers";

describe("machines", () => {
  it("a field left out of a save keeps its value, and a stale save is refused", async () => {
    const svc = await person("service");
    const serial = `${1000 + Math.floor(Math.random() * 8999)}MB`;
    const { data } = await svc.json("/api/machines", { body: { serial, model: "Monoblock", customer: "Acme Test", site: "Plant 1", notes: "keep me" } });
    const m1 = (await svc.json(`/api/machines/${data.id}`)).data.machine;
    expect((await svc.fetch(`/api/machines/${data.id}`, { method: "PATCH", body: { site: "Plant 2", updated_at: m1.updated_at } })).status).toBe(200);
    const m2 = (await svc.json(`/api/machines/${data.id}`)).data.machine;
    expect(m2).toMatchObject({ site: "Plant 2", notes: "keep me", model: "Monoblock" });
    expect((await svc.fetch(`/api/machines/${data.id}`, { method: "PATCH", body: { site: "Plant 3", updated_at: "2000-01-01T00:00:00.000Z" } })).status).toBe(409);
  });
});

describe("job files", () => {
  it("someone who can see jobs can add a file to one without the chats permission", async () => {
    const sched = await person("scheduling");
    const job = await sched.json("/api/jobs", { body: { job_number: `J-${crypto.randomUUID().slice(0, 6)}`, customer: "Acme Test", days: ["2026-12-01"] } });
    expect(job.status, JSON.stringify(job.data)).toBe(200);
    const tech = await person("tech");
    const admin = await person("admin");
    await admin.json(`/api/users/${tech.id}/access`, { method: "PUT", body: { changes: { "files.send": false } } });
    const form = new FormData();
    form.append("file", new File(["hello"], "note.txt", { type: "text/plain" }));
    const r = await tech.fetch(`/api/jobs/${job.data.id}/files`, { method: "POST", body: form });
    expect(r.status).not.toBe(403);
  });
});
