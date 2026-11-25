import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import { forgetSettings } from "../../src/portal/lib/settings-store";
import { MONEY_WORDS } from "../../src/shared/reports";
import { person } from "./helpers";

// The Ronchi workbook's job paperwork: job chat, time sheets and service reports (routes/reports.ts).

let num = 0;
const jobBody = (extra: Record<string, unknown> = {}) => ({
  job_number: `R-${++num}-${crypto.randomUUID().slice(0, 4)}`, customer: "Acme Bottling", machine: "4222TP",
  location: "1 Main St, Pottstown, PA", work_days: ["2026-12-01", "2026-12-02"], notify: false, ...extra,
});

async function setup() {
  const meagan = await person("scheduling", { name: "Meagan Hooper" });
  const patrick = await person("tech", { name: "Patrick Morgan" });
  const elim = await person("tech", { name: "Elim Ramirez" });
  const job = (await meagan.json("/api/jobs", { body: jobBody({ techIds: [patrick.id, elim.id] }) })).data.id as string;
  return { meagan, patrick, elim, job };
}

afterEach(async () => {
  await env.DB.prepare("DELETE FROM feature_switches").run();
  await env.DB.prepare("DELETE FROM settings").run();
  forgetSettings();
});

describe("time sheets", () => {
  it("an engineer fills in their own sheet as they type, and sends it for review", async () => {
    const { patrick, job } = await setup();
    const start = await patrick.json(`/api/reports/jobs/${job}/start`, { body: {} });
    expect(start.status).toBe(200);
    const sheet = start.data.sheetId as string;
    const day = await patrick.json(`/api/reports/sheets/${sheet}/days`, { body: { work_date: "2026-12-01" } });
    expect(day.status).toBe(200);
    // Autosave sends one field at a time.
    for (const patch of [{ start_time: "07:00" }, { end_time: "15:30" }, { break_min: 30 }, { travel_hours: "1.5" }, { production_hours: "6" }, { notes: "Changeover to 1 L" }]) {
      expect((await patrick.json(`/api/reports/sheets/${sheet}/days/${day.data.id}`, { method: "PATCH", body: patch })).status).toBe(200);
    }
    const exp = await patrick.json(`/api/reports/sheets/${sheet}/expenses`, { body: { exp_date: "2026-12-01", type: "mileage", description: "Airport to plant", quantity: 42 } });
    expect(exp.status).toBe(200);
    const receipt = new FormData();
    receipt.append("files", new File(["jpg"], "receipt.jpg", { type: "image/jpeg" }));
    expect((await patrick.form(`/api/reports/sheets/${sheet}/expenses/${exp.data.id}/receipt`, receipt)).status).toBe(200);

    const mine = await patrick.json(`/api/reports/jobs/${job}`);
    expect(mine.status).toBe(200);
    const s = mine.data.sheets.find((x: any) => x.id === sheet);
    expect(s.days[0]).toMatchObject({ start_time: "07:00", end_time: "15:30", break_min: 30, travel_min: 90, production_min: 360, notes: "Changeover to 1 L" });
    expect(s.totals).toMatchObject({ work: 480, billable: 480, travel: 90, production: 360 });
    expect(s.expenses[0]).toMatchObject({ type: "mileage", quantity: 42 });
    expect(s.expenses[0].receipt.name).toBe("receipt.jpg");
    expect(JSON.stringify(s.expenses[0])).not.toMatch(/amount/);
    const photo = await patrick.fetch(`/api/reports/files/${s.expenses[0].receipt.id}`);
    expect(photo.status).toBe(200);

    expect((await patrick.json(`/api/reports/sheets/${sheet}/send`, { body: {} })).status).toBe(200);
    // Sent: waiting for review, so no more changes until it is sent back.
    expect((await patrick.json(`/api/reports/sheets/${sheet}/days/${day.data.id}`, { method: "PATCH", body: { notes: "late change" } })).status).toBe(409);
  });

  it("another engineer on the same job can't see or change it", async () => {
    const { patrick, elim, job } = await setup();
    const sheet = (await patrick.json(`/api/reports/jobs/${job}/start`, { body: {} })).data.sheetId;
    const day = await patrick.json(`/api/reports/sheets/${sheet}/days`, { body: { work_date: "2026-12-01" } });
    const forElim = await elim.json(`/api/reports/jobs/${job}`);
    expect(forElim.data.sheets.map((x: any) => x.id)).not.toContain(sheet);
    expect((await elim.json(`/api/reports/sheets/${sheet}`)).status).toBe(404);
    expect((await elim.json(`/api/reports/sheets/${sheet}/days/${day.data.id}`, { method: "PATCH", body: { notes: "x" } })).status).toBe(404);
    expect((await elim.json(`/api/reports/sheets/${sheet}/send`, { body: {} })).status).toBe(404);
  });

  it("only engineers on the job can start paperwork for it", async () => {
    const { job } = await setup();
    const other = await person("tech");
    expect((await other.json(`/api/reports/jobs/${job}/start`, { body: {} })).status).toBe(403);
  });

  it("a reviewer approves or sends back with a note; approved is locked", async () => {
    const { meagan, patrick, job } = await setup();
    const sheet = (await patrick.json(`/api/reports/jobs/${job}/start`, { body: {} })).data.sheetId;
    const day = await patrick.json(`/api/reports/sheets/${sheet}/days`, { body: { work_date: "2026-12-01", start_time: "08:00", end_time: "16:00" } });
    // An engineer can't approve, and nothing can be approved before it is sent.
    expect((await meagan.json(`/api/reports/sheets/${sheet}/approve`, { body: {} })).status).toBe(409);
    await patrick.json(`/api/reports/sheets/${sheet}/send`, { body: {} });
    expect((await patrick.json(`/api/reports/sheets/${sheet}/approve`, { body: {} })).status).toBe(403);

    const queue = await meagan.json("/api/reports/queue?status=sent");
    expect(queue.data.items.map((x: any) => x.id)).toContain(sheet);
    expect((await meagan.json(`/api/reports/sheets/${sheet}/return`, { body: {} })).status).toBe(400); // a note is required
    expect((await meagan.json(`/api/reports/sheets/${sheet}/return`, { body: { note: "Add the travel home." } })).status).toBe(200);
    const back = await patrick.json(`/api/reports/sheets/${sheet}`);
    expect(back.data.sheet).toMatchObject({ status: "returned", review_note: "Add the travel home." });
    expect((await patrick.json(`/api/reports/sheets/${sheet}/days/${day.data.id}`, { method: "PATCH", body: { travel_hours: 2 } })).status).toBe(200);
    await patrick.json(`/api/reports/sheets/${sheet}/send`, { body: {} });
    expect((await meagan.json(`/api/reports/sheets/${sheet}/approve`, { body: {} })).status).toBe(200);

    // Approved: locked for everyone, the engineer included, until a reviewer sends it back.
    expect((await patrick.json(`/api/reports/sheets/${sheet}/days/${day.data.id}`, { method: "PATCH", body: { notes: "x" } })).status).toBe(409);
    expect((await patrick.json(`/api/reports/sheets/${sheet}/days/${day.data.id}`, { method: "DELETE" })).status).toBe(409);
    expect((await patrick.json(`/api/reports/sheets/${sheet}/recall`, { body: {} })).status).toBe(409);
    expect((await meagan.json(`/api/reports/sheets/${sheet}/days/${day.data.id}`, { method: "PATCH", body: { notes: "x" } })).status).toBe(403);
    const approved = await meagan.json("/api/reports/queue?status=approved");
    expect(approved.data.items.find((x: any) => x.id === sheet)).toMatchObject({ kind: "sheet", user_name: "Patrick Morgan", hours: { work: 480 } });
  });

  it("exports hours as CSV for reviewers only, safe for Excel, with no money columns", async () => {
    const { meagan, patrick, job } = await setup();
    const sheet = (await patrick.json(`/api/reports/jobs/${job}/start`, { body: {} })).data.sheetId;
    await patrick.json(`/api/reports/sheets/${sheet}/days`, { body: { work_date: "2026-12-01", start_time: "08:00", end_time: "12:00", notes: "=HYPERLINK(1)" } });
    await patrick.json(`/api/reports/sheets/${sheet}/send`, { body: {} });
    expect((await patrick.fetch("/api/reports/export")).status).toBe(403);
    const csv = await meagan.fetch("/api/reports/export?status=sent");
    expect(csv.status).toBe(200);
    const body = await csv.text();
    expect(body).toContain("Patrick Morgan");
    expect(body).toContain("4.00");
    expect(body).toContain("'=HYPERLINK(1)");
    expect(body.split("\r\n")[0]).not.toMatch(MONEY_WORDS);
  });
});

describe("service reports", () => {
  it("an engineer writes the report, adds photos, and the customer signs on the screen", async () => {
    const { meagan, patrick, job } = await setup();
    const report = (await patrick.json(`/api/reports/jobs/${job}/start`, { body: {} })).data.reportId as string;
    expect((await patrick.json(`/api/reports/service/${report}`, { method: "PATCH", body: { summary: "Replaced both O-rings.", recipe: "Head 7 offset +0.4 g" } })).status).toBe(200);
    expect((await patrick.json(`/api/reports/service/${report}/log`, { body: { work_date: "2026-12-01", text: "Set up line 2." } })).status).toBe(200);
    expect((await patrick.json(`/api/reports/service/${report}/parts`, { body: { kind: "used", part_code: "12.345.678", description: "O-ring 38mm", qty: 2 } })).status).toBe(200);
    const photos = new FormData();
    photos.append("files", new File(["a"], "before.jpg", { type: "image/jpeg" }));
    photos.append("files", new File(["b"], "after.jpg", { type: "image/jpeg" }));
    expect((await patrick.form(`/api/reports/service/${report}/photos`, photos)).status).toBe(200);
    const bad = new FormData();
    bad.append("files", new File(["<svg/>"], "x.svg"));
    expect((await patrick.form(`/api/reports/service/${report}/photos`, bad)).status).toBe(400);
    const sig = new FormData();
    sig.append("file", new File([new Uint8Array([137, 80, 78, 71])], "signature.png", { type: "image/png" }));
    expect((await patrick.form(`/api/reports/service/${report}/signature`, sig)).status).toBe(200);
    expect((await patrick.json(`/api/reports/service/${report}`, { method: "PATCH", body: { signer_name: "Dana Smith", signed_on: "2026-12-02" } })).status).toBe(200);

    const r = (await patrick.json(`/api/reports/service/${report}`)).data;
    expect(r.report).toMatchObject({ summary: "Replaced both O-rings.", signer_name: "Dana Smith", signed_on: "2026-12-02", status: "draft" });
    expect(r.report.signature.name).toBe("signature.png");
    expect(r.log[0].text).toBe("Set up line 2.");
    expect(r.parts[0]).toMatchObject({ kind: "used", part_code: "12.345.678", qty: 2 });
    expect(r.photos.map((p: any) => p.name).sort()).toEqual(["after.jpg", "before.jpg"]);
    // Pre-filled job details for the printed report.
    expect(r.job).toMatchObject({ customer: "Acme Bottling", machine: "4222TP" });
    expect(r.job.techs.map((x: any) => x.name).sort()).toEqual(["Elim Ramirez", "Patrick Morgan"]);

    await patrick.json(`/api/reports/service/${report}/send`, { body: {} });
    expect((await meagan.json(`/api/reports/service/${report}/approve`, { body: {} })).status).toBe(200);
    expect((await patrick.json(`/api/reports/service/${report}`, { method: "PATCH", body: { summary: "changed" } })).status).toBe(409);
    const more = new FormData();
    more.append("files", new File(["c"], "late.jpg"));
    expect((await patrick.form(`/api/reports/service/${report}/photos`, more)).status).toBe(409);
  });
});

describe("job chat", () => {
  it("is made on first open for the job's engineers and its scheduler, and follows the engineers", async () => {
    const { meagan, patrick, elim, job } = await setup();
    const open = await patrick.json(`/api/reports/jobs/${job}/chat`, { body: {} });
    expect(open.status).toBe(200);
    const chatId = open.data.id as string;
    expect((await patrick.json(`/api/reports/jobs/${job}/chat`, { body: {} })).data.id).toBe(chatId); // the same chat every time
    const members = async () => ((await patrick.json(`/api/boards/${chatId}`)).data.members as any[]).map((m) => m.id).sort();
    expect(await members()).toEqual([meagan.id, patrick.id, elim.id].sort());
    expect((await elim.json(`/api/boards/${chatId}`)).status).toBe(200);
    // Private: someone not on the job can't read it, and can't open it from the job either.
    const outsider = await person("tech");
    expect((await outsider.json(`/api/boards/${chatId}`)).status).toBe(404);
    expect((await outsider.json(`/api/reports/jobs/${job}/chat`, { body: {} })).status).toBe(403);
    // Engineers added to the job join the chat; engineers taken off leave it.
    const andrew = await person("tech", { name: "Andrew Jackson" });
    const j = (await meagan.json(`/api/jobs/${job}`)).data.job;
    expect((await meagan.json(`/api/jobs/${job}`, { method: "PATCH", body: { revision: j.revision, techIds: [patrick.id, andrew.id], notify: false } })).status).toBe(200);
    expect(await members()).toEqual([meagan.id, patrick.id, andrew.id].sort());
    expect((await elim.json(`/api/boards/${chatId}`)).status).toBe(404);
    // Another scheduler joins when they open it.
    const april = await person("service");
    expect((await april.json(`/api/reports/jobs/${job}/chat`, { body: {} })).data.id).toBe(chatId);
    expect(await members()).toContain(april.id);
  });
});

describe("switches and access", () => {
  it("the workbook switch off makes all of it Not found", async () => {
    const { patrick, job } = await setup();
    const admin = await person("admin");
    const sheet = (await patrick.json(`/api/reports/jobs/${job}/start`, { body: {} })).data.sheetId;
    expect((await admin.json("/api/switches/workbook", { method: "PUT", body: { on: false } })).status).toBe(200);
    expect((await patrick.json(`/api/reports/jobs/${job}`)).status).toBe(404);
    expect((await patrick.json(`/api/reports/sheets/${sheet}`)).status).toBe(404);
    expect((await patrick.json(`/api/reports/jobs/${job}/chat`, { body: {} })).status).toBe(404);
    expect((await admin.json("/api/reports/queue")).status).toBe(404);
  });

  it("the reports section switched off closes it to everyone but admins", async () => {
    const { patrick, job } = await setup();
    const admin = await person("admin");
    expect((await admin.json("/api/settings", { method: "PUT", body: { sections: { reports: false } } })).status).toBe(200);
    expect((await patrick.json(`/api/reports/jobs/${job}`)).status).toBe(403);
    expect((await admin.json("/api/reports/queue")).status).toBe(200);
  });

  it("the workbook tables have no money columns", async () => {
    for (const table of ["time_sheets", "time_days", "time_expenses", "service_reports", "report_log", "report_parts", "report_files", "job_chats"]) {
      const { results } = await env.DB.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
      expect(results.length, table).toBeGreaterThan(0);
      expect(results.map((c) => c.name).filter((n) => MONEY_WORDS.test(n)), table).toEqual([]);
    }
  });
});
