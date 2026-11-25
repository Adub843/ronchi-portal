// The Ronchi workbook inside Work orders (src/portal/routes/workbook.ts): service report, daily log,
// photos, billable hours (customer billing, not a time clock), expenses, job chat, Submit, billing week.
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import { person } from "./helpers";

const e = env as any;
const sent: any[] = [];
afterEach(() => {
  delete e.EMAIL;
  delete e.MAIL_FROM;
  sent.length = 0;
});

let num = 0;
async function jobWith(scheduler: Awaited<ReturnType<typeof person>>, techIds: string[], machine = "3069MB") {
  const r = await scheduler.json("/api/jobs", { body: { job_number: `26-${++num}${crypto.randomUUID().slice(0, 3)}-S1`, customer: "Acme Bottling", machine, work_days: ["2026-11-23", "2026-11-24"], techIds } });
  expect(r.status).toBe(200);
  return r.data.id as string;
}

describe("filling in a work order", () => {
  it("the engineer on the job writes the report, the log, billable hours and expenses", async () => {
    const meagan = await person("scheduling");
    const aaron = await person("tech");
    const id = await jobWith(meagan, [aaron.id]);
    const w = `/api/workbook/${id}`;

    expect((await aaron.json(`${w}/report`, { method: "PUT", body: { revision: 0, scope: "Line Down", summary: "Replaced the starwheel." } })).status).toBe(200);
    expect((await aaron.json(`${w}/entries`, { body: { day: "2026-11-23", work: "Line Down", description: "Found worn starwheel", done: "N", pct: "51–75%", issues: "Starwheel worn" } })).status).toBe(200);
    expect((await aaron.json(`${w}/hours`, { method: "PUT", body: { day: "2026-11-23", regular: 8, overtime: 2, travel_wd: 1.5, miles: 40 } })).status).toBe(200);
    // Saving the same day again replaces it (one row per engineer per day).
    expect((await aaron.json(`${w}/hours`, { method: "PUT", body: { day: "2026-11-23", regular: 8, overtime: 3, miles: 40 } })).status).toBe(200);
    expect((await aaron.json(`${w}/expenses`, { body: { day: "2026-11-23", type: "Hotel", amount: "129.00", description: "Hampton Inn" } })).status).toBe(200);

    const wb = await aaron.json(w);
    expect(wb.status).toBe(200);
    expect(wb.data.canFill).toBe(true);
    expect(wb.data.report).toMatchObject({ scope: "Line Down", summary: "Replaced the starwheel.", status: "draft", revision: 1 });
    expect(wb.data.entries).toHaveLength(1);
    expect(wb.data.hours).toHaveLength(1);
    expect(wb.data.hours[0]).toMatchObject({ regular: 8, overtime: 3, travel_wd: 0, miles: 40 });
    // S job numbers are billable by default (the old workbook's rule).
    expect(wb.data.expenses[0]).toMatchObject({ type: "Hotel", billable: "Y", pay: "Credit", description: "Hampton Inn" });
    // Field service engineers never see a dollar amount, not even their own (Aaron, 2026-11-25).
    expect(wb.data.money).toBe(false);
    expect(wb.data.expenses[0].amount_cents).toBeUndefined();
    expect(JSON.stringify(wb.data)).not.toContain("12900");
    // The scheduler and billing do see it.
    const sched = await meagan.json(w);
    expect(sched.data.money).toBe(true);
    expect(sched.data.expenses[0]).toMatchObject({ amount_cents: 12900 });
  });

  it("an expense receipt stays out of the job's files and photos, and only people who see expenses can open it", async () => {
    const meagan = await person("scheduling");
    const aaron = await person("tech");
    const viewer = await person("tech");
    const id = await jobWith(meagan, [aaron.id]);
    const form = new FormData();
    form.append("files", new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], "receipt.jpg", { type: "image/jpeg" }));
    const up = await aaron.form(`/api/jobs/${id}/files`, form);
    expect(up.status).toBe(200);
    const receipt = ((await up.json()) as any).ids[0];
    expect((await aaron.json(`/api/workbook/${id}/expenses`, { body: { day: "2026-11-23", type: "Hotel", amount: "129.00", receipt_file: receipt } })).status).toBe(200);
    const job = await viewer.json(`/api/jobs/${id}`);
    expect(job.data.files.map((f: any) => f.id)).not.toContain(receipt);
    expect((await viewer.json(`/api/workbook/${id}`)).data.photos.map((p: any) => p.id)).not.toContain(receipt);
    expect((await viewer.fetch(`/api/jobs/files/${receipt}`)).status).toBe(404);
    // A receipt shows the amount, so not even the engineer who added it can open it afterwards.
    expect((await aaron.fetch(`/api/jobs/files/${receipt}`)).status).toBe(404);
    expect((await meagan.fetch(`/api/jobs/files/${receipt}`)).status).toBe(200);
    const lola = await person("billing");
    expect((await lola.fetch(`/api/jobs/files/${receipt}`)).status).toBe(200);
  });

  it("nothing can be added to the log, hours or expenses once the report is submitted", async () => {
    const meagan = await person("scheduling");
    const aaron = await person("tech");
    const id = await jobWith(meagan, [aaron.id]);
    const w = `/api/workbook/${id}`;
    await aaron.json(`${w}/entries`, { body: { day: "2026-11-23", description: "Work" } });
    expect((await aaron.json(`${w}/submit`, { body: {} })).status).toBe(200);
    expect((await aaron.json(`${w}/submit`, { body: {} })).status).toBe(409);
    expect((await aaron.json(`${w}/entries`, { body: { day: "2026-11-24", description: "Late" } })).status).toBe(409);
    expect((await aaron.json(`${w}/hours`, { method: "PUT", body: { day: "2026-11-24", regular: 4 } })).status).toBe(409);
    expect((await aaron.json(`${w}/expenses`, { body: { day: "2026-11-24", type: "Meals", amount: "12.00" } })).status).toBe(409);
  });

  it("two people can't overwrite each other's report", async () => {
    const meagan = await person("scheduling");
    const aaron = await person("tech");
    const id = await jobWith(meagan, [aaron.id]);
    await aaron.json(`/api/workbook/${id}/report`, { method: "PUT", body: { revision: 0, summary: "first" } });
    const stale = await meagan.json(`/api/workbook/${id}/report`, { method: "PUT", body: { revision: 0, summary: "second" } });
    expect(stale.status).toBe(409);
  });

  it("refuses bad hours, and anyone not on the job", async () => {
    const meagan = await person("scheduling");
    const aaron = await person("tech");
    const other = await person("tech");
    const id = await jobWith(meagan, [aaron.id]);
    expect((await aaron.json(`/api/workbook/${id}/hours`, { method: "PUT", body: { day: "2026-11-23", regular: 20, overtime: 6 } })).status).toBe(400);
    expect((await other.json(`/api/workbook/${id}/entries`, { body: { day: "2026-11-23", description: "x" } })).status).toBe(403);
    expect((await other.json(`/api/workbook/${id}/hours`, { method: "PUT", body: { day: "2026-11-23", regular: 8 } })).status).toBe(403);
    // An engineer can't put hours under someone else's name; a scheduler can, for an engineer on the job.
    expect((await aaron.json(`/api/workbook/${id}/hours`, { method: "PUT", body: { day: "2026-11-23", regular: 8, user_id: other.id } })).status).toBe(403);
    expect((await meagan.json(`/api/workbook/${id}/hours`, { method: "PUT", body: { day: "2026-11-23", regular: 8, user_id: aaron.id } })).status).toBe(200);
    expect((await meagan.json(`/api/workbook/${id}/hours`, { method: "PUT", body: { day: "2026-11-23", regular: 8, user_id: other.id } })).status).toBe(400);
  });

  it("people who only see jobs can read the work order but not its hours or expenses", async () => {
    const meagan = await person("scheduling");
    const aaron = await person("tech");
    const sales = await person("sales");
    const id = await jobWith(meagan, [aaron.id]);
    await aaron.json(`/api/workbook/${id}/expenses`, { body: { day: "2026-11-23", type: "Meals", amount: "20" } });
    const wb = await sales.json(`/api/workbook/${id}`);
    expect(wb.status).toBe(200);
    expect(wb.data.canFill).toBe(false);
    expect(wb.data.hours).toBeNull();
    expect(wb.data.expenses).toBeNull();
  });
});

describe("the job's chat", () => {
  it("is made once, with the engineers and the scheduler, and only they can open it", async () => {
    const meagan = await person("scheduling");
    const aaron = await person("tech");
    const sales = await person("sales");
    const id = await jobWith(meagan, [aaron.id]);
    const a = await aaron.json(`/api/workbook/${id}/chat`, { body: {} });
    expect(a.status).toBe(200);
    const again = await meagan.json(`/api/workbook/${id}/chat`, { body: {} });
    expect(again.data.id).toBe(a.data.id);
    const chat = await meagan.json(`/api/boards/${a.data.id}`);
    expect(chat.status).toBe(200);
    expect((await sales.json(`/api/workbook/${id}/chat`, { body: {} })).status).toBe(403);
    expect((await sales.json(`/api/boards/${a.data.id}`)).status).toBe(404);
  });
});

describe("Submit", () => {
  it("sends the report to the chosen people, adds a quick note per problem, and locks the report", async () => {
    e.EMAIL = { send: async (m: any) => { sent.push(m); return { messageId: "m1" }; } };
    e.MAIL_FROM = "workbook@ronchi.test";
    const admin = await person("admin");
    const lola = await person("billing", { name: "Lola Parker" });
    const meagan = await person("scheduling");
    const aaron = await person("tech", { name: "Aaron Lewis" });
    expect((await meagan.json("/api/workbook/settings/recipients", { method: "PUT", body: { userIds: [lola.id] } })).status).toBe(403);
    expect((await admin.json("/api/workbook/settings/recipients", { method: "PUT", body: { userIds: [lola.id] } })).status).toBe(200);

    const id = await jobWith(meagan, [aaron.id], "3981MB");
    const w = `/api/workbook/${id}`;
    expect((await aaron.json(`${w}/submit`, { body: {} })).status).toBe(400); // nothing in the log yet
    await aaron.json(`${w}/entries`, { body: { day: "2026-11-23", description: "Re-timed the capper", issues: "- Capper head 4 slips\n- Infeed guide loose" } });
    await aaron.json(`${w}/hours`, { method: "PUT", body: { day: "2026-11-23", regular: 8 } });
    const s = await aaron.json(`${w}/submit`, { body: {} });
    expect(s.status).toBe(200);
    expect(s.data.notes).toHaveLength(2);
    expect(s.data.sent).toEqual([expect.objectContaining({ name: "Lola Parker", status: "sent" })]);
    const mail = sent.find((m) => m.subject.startsWith("Service report"));
    expect(mail.to).toBe(lola.email);
    expect(mail.text).toContain("Total billable hours: 8");

    const kb = await aaron.json("/api/kb?serial=3981MB");
    expect(kb.data.results.map((a: any) => a.title)).toEqual(expect.arrayContaining(["Capper head 4 slips", "Infeed guide loose"]));

    expect((await aaron.json(`${w}/entries`, { body: { day: "2026-11-24", description: "late add" } })).status).toBe(409);
    expect((await aaron.json(`${w}/reopen`, { body: {} })).status).toBe(403);
    expect((await meagan.json(`${w}/reopen`, { body: {} })).status).toBe(200);
    expect((await aaron.json(`${w}/entries`, { body: { day: "2026-11-24", description: "late add" } })).status).toBe(200);
  });

  it("sends expense amounts only to people who may see them", async () => {
    e.EMAIL = { send: async (m: any) => { sent.push(m); return { messageId: "m1" }; } };
    e.MAIL_FROM = "workbook@ronchi.test";
    const admin = await person("admin");
    const lola = await person("billing");
    const sam = await person("sales");
    const meagan = await person("scheduling");
    const aaron = await person("tech");
    expect((await admin.json("/api/workbook/settings/recipients", { method: "PUT", body: { userIds: [lola.id, sam.id] } })).status).toBe(200);
    const id = await jobWith(meagan, [aaron.id]);
    const w = `/api/workbook/${id}`;
    await aaron.json(`${w}/entries`, { body: { day: "2026-11-23", description: "Work" } });
    await aaron.json(`${w}/expenses`, { body: { day: "2026-11-23", type: "Hotel", amount: "129.00" } });
    expect((await aaron.json(`${w}/submit`, { body: {} })).status).toBe(200);
    expect(sent.find((m) => m.to === lola.email).text).toContain("Total expenses: 129.00");
    expect(sent.find((m) => m.to === sam.email).text).not.toContain("129.00");
  });

  it("never sends dollar amounts to a field service engineer, even one on the job", async () => {
    e.EMAIL = { send: async (m: any) => { sent.push(m); return { messageId: "m1" }; } };
    e.MAIL_FROM = "workbook@ronchi.test";
    const admin = await person("admin");
    const meagan = await person("scheduling");
    const aaron = await person("tech");
    const steve = await person("tech");
    expect((await admin.json("/api/workbook/settings/recipients", { method: "PUT", body: { userIds: [steve.id] } })).status).toBe(200);
    const id = await jobWith(meagan, [aaron.id, steve.id]);
    const w = `/api/workbook/${id}`;
    await aaron.json(`${w}/entries`, { body: { day: "2026-11-23", description: "Work" } });
    await aaron.json(`${w}/hours`, { method: "PUT", body: { day: "2026-11-23", regular: 8 } });
    await aaron.json(`${w}/expenses`, { body: { day: "2026-11-23", type: "Hotel", amount: "129.00", description: "Hampton Inn" } });
    const s = await aaron.json(`${w}/submit`, { body: {} });
    expect(s.status).toBe(200);
    // What comes back to the engineer who pressed Submit (to send from their own email) has no money either.
    expect(s.data.text).not.toContain("129");
    expect(s.data.text).toContain("Hotel");
    expect(s.data.text).toContain("Total billable hours: 8");
    const mail = sent.find((m) => m.to === steve.email && m.subject.startsWith("Service report"));
    expect(mail.text).not.toContain("129");
    expect(mail.text).toContain("Hotel");
  });
});

describe("billing", () => {
  it("sees every engineer's billable hours and expenses for a week; others can't", async () => {
    const meagan = await person("scheduling");
    const aaron = await person("tech");
    const lola = await person("billing");
    const id = await jobWith(meagan, [aaron.id]);
    await aaron.json(`/api/workbook/${id}/hours`, { method: "PUT", body: { day: "2026-11-24", regular: 7.5 } });
    await aaron.json(`/api/workbook/${id}/expenses`, { body: { day: "2026-11-25", type: "Fuel", amount: "45.10" } });
    await aaron.json(`/api/workbook/${id}/hours`, { method: "PUT", body: { day: "2026-12-01", regular: 4 } }); // next week
    const wk = await lola.json("/api/workbook/billing/week?start=2026-11-25");
    expect(wk.status).toBe(200);
    expect(wk.data.start).toBe("2026-11-23");
    const mine = wk.data.hours.filter((h: any) => h.job_id === id);
    expect(mine.map((h: any) => h.day)).toEqual(["2026-11-24"]);
    expect(wk.data.expenses.filter((x: any) => x.job_id === id)[0]).toMatchObject({ amount_cents: 4510 });
    expect((await aaron.json("/api/workbook/billing/week")).status).toBe(403);
  });
});

describe("the workbook switch", () => {
  it("off, every workbook route answers Not found", async () => {
    const admin = await person("admin");
    const meagan = await person("scheduling");
    const aaron = await person("tech");
    const id = await jobWith(meagan, [aaron.id]);
    expect((await admin.json("/api/switches/workbook", { method: "PUT", body: { on: false } })).status).toBe(200);
    try {
      expect((await aaron.json(`/api/workbook/${id}`)).status).toBe(404);
      expect((await aaron.json(`/api/workbook/${id}/hours`, { method: "PUT", body: { day: "2026-11-23", regular: 8 } })).status).toBe(404);
    } finally {
      await admin.json("/api/switches/workbook", { method: "PUT", body: { on: true } });
    }
  });
});
