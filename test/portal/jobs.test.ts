import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import { person } from "./helpers";

const sent: any[] = [];
const e = env as any;
afterEach(() => {
  delete e.EMAIL;
  delete e.MAIL_FROM;
  sent.length = 0;
});
function emailOn() {
  e.EMAIL = { send: async (m: any) => { sent.push(m); return { messageId: "m1" }; } };
  e.MAIL_FROM = "jobs@ronchi.test";
}

let num = 0;
const jobBody = (extra: Record<string, unknown> = {}) => ({
  job_number: `J-${++num}-${crypto.randomUUID().slice(0, 4)}`, customer: "Acme Bottling", machine: "4110mb",
  location: "1 Main St, Pottstown, PA", contact_name: "Dana Smith", contact_phone: "555-0100", contact_email: "dana@acme.test",
  work_days: ["2026-12-02", "2026-12-01"], notes: "Bring the 38mm parts.", ...extra,
});

describe("tech jobs", () => {
  it("scheduling makes a job with every field, and a tech can open it", async () => {
    const meagan = await person("scheduling");
    const tech = await person("tech");
    const r = await meagan.json("/api/jobs", { body: jobBody({ techIds: [tech.id] }) });
    expect(r.status).toBe(200);
    const j = await tech.json(`/api/jobs/${r.data.id}`);
    expect(j.status).toBe(200);
    expect(j.data.job).toMatchObject({ customer: "Acme Bottling", machine: "4110MB", location: "1 Main St, Pottstown, PA", contact_name: "Dana Smith", contact_phone: "555-0100", contact_email: "dana@acme.test", notes: "Bring the 38mm parts.", status: "scheduled" });
    expect(j.data.job.work_days).toEqual(["2026-12-01", "2026-12-02"]);
    expect(j.data.techs.map((t: any) => t.id)).toEqual([tech.id]);
    expect(j.data.maps.waze).toContain("waze.com");
  });

  it("only schedulers can make or change jobs", async () => {
    const tech = await person("tech");
    expect((await tech.json("/api/jobs", { body: jobBody() })).status).toBe(403);
    const sales = await person("sales");
    expect((await sales.json("/api/jobs", { body: jobBody() })).status).toBe(403);
  });

  it("needs a job number and customer, and refuses a repeated job number or a bad date", async () => {
    const m = await person("scheduling");
    expect((await m.json("/api/jobs", { body: jobBody({ job_number: "" }) })).status).toBe(400);
    expect((await m.json("/api/jobs", { body: jobBody({ customer: "" }) })).status).toBe(400);
    expect((await m.json("/api/jobs", { body: jobBody({ work_days: ["2026-02-30"] }) })).status).toBe(400);
    const b = jobBody();
    expect((await m.json("/api/jobs", { body: b })).status).toBe(200);
    expect((await m.json("/api/jobs", { body: { ...b, job_number: b.job_number.toLowerCase() } })).status).toBe(409);
  });

  it("emails each tech a link to the job's work order, only the new techs on a change", async () => {
    emailOn();
    const m = await person("scheduling", { name: "Meagan Hooper" });
    const t1 = await person("tech", { name: "Elim Ramirez" });
    const t2 = await person("tech", { name: "Patrick Morgan" });
    const r = await m.json("/api/jobs", { body: jobBody({ techIds: [t1.id] }) });
    expect(r.data.emails).toEqual([expect.objectContaining({ userId: t1.id, status: "sent" })]);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(t1.email);
    expect(sent[0].from).toEqual({ email: "jobs@ronchi.test", name: "Ronchi Portal" });
    expect(sent[0].text).toContain(`${env.ORIGIN}/work-orders/${r.data.id}`);
    expect(sent[0].text).toContain("Meagan Hooper scheduled you");
    const j = await m.json(`/api/jobs/${r.data.id}`);
    const p = await m.json(`/api/jobs/${r.data.id}`, { method: "PATCH", body: { revision: j.data.job.revision, techIds: [t1.id, t2.id] } });
    expect(p.status).toBe(200);
    expect(sent).toHaveLength(2);
    expect(sent[1].to).toBe(t2.email);
    // Send again on request
    const again = await m.json(`/api/jobs/${r.data.id}/email`, { body: { userIds: [t1.id] } });
    expect(again.data.emails[0].status).toBe("sent");
    expect(sent).toHaveLength(3);
  });

  it("without email set up, says so and gives the email to send by hand", async () => {
    const m = await person("scheduling");
    const t1 = await person("tech");
    const r = await m.json("/api/jobs", { body: jobBody({ techIds: [t1.id] }) });
    expect(r.data.emails[0]).toMatchObject({ status: "not_set_up", to: t1.email });
    expect(r.data.emails[0].subject).toContain("Acme Bottling");
    expect(r.data.emails[0].text).toContain(`/work-orders/${r.data.id}`);
    const j = await m.json(`/api/jobs/${r.data.id}`);
    expect(j.data.techs[0].email_status).toBe("not_set_up");
  });

  it("a stale save is refused", async () => {
    const m = await person("scheduling");
    const r = await m.json("/api/jobs", { body: jobBody() });
    expect((await m.json(`/api/jobs/${r.data.id}`, { method: "PATCH", body: { revision: 1, notes: "a" } })).status).toBe(200);
    expect((await m.json(`/api/jobs/${r.data.id}`, { method: "PATCH", body: { revision: 1, notes: "b" } })).status).toBe(409);
  });

  it("anyone on the job can add files, and they show on the job; other file types are refused", async () => {
    const m = await person("scheduling");
    const tech = await person("tech");
    const r = await m.json("/api/jobs", { body: jobBody({ techIds: [tech.id] }) });
    const form = new FormData();
    form.append("files", new File(["report"], "Service report.pdf", { type: "application/pdf" }));
    form.append("files", new File(["jpg"], "photo.jpg", { type: "image/jpeg" }));
    const up = await tech.form(`/api/jobs/${r.data.id}/files`, form);
    expect(up.status).toBe(200);
    const j = await m.json(`/api/jobs/${r.data.id}`);
    expect(j.data.files.map((f: any) => f.name).sort()).toEqual(["Service report.pdf", "photo.jpg"]);
    const pdf = j.data.files.find((f: any) => f.ext === "pdf");
    const dl = await m.fetch(`/api/jobs/files/${pdf.id}`);
    expect(dl.status).toBe(200);
    expect(dl.headers.get("content-disposition")).toContain("attachment");
    expect(await dl.text()).toBe("report");
    const bad = new FormData();
    bad.append("files", new File(["x"], "page.html"));
    expect((await tech.form(`/api/jobs/${r.data.id}/files`, bad)).status).toBe(400);
    // The tech who added it can remove it; someone else can't.
    const other = await person("tech");
    expect((await other.fetch(`/api/jobs/files/${pdf.id}`, { method: "DELETE" })).status).toBe(403);
    expect((await tech.fetch(`/api/jobs/files/${pdf.id}`, { method: "DELETE" })).status).toBe(200);
  });

  it("someone with job access switched off sees no jobs, even ones they're on (deny by default)", async () => {
    const admin = await person("admin");
    const m = await person("scheduling");
    const tech = await person("tech");
    const mine = await m.json("/api/jobs", { body: jobBody({ techIds: [tech.id] }) });
    expect((await admin.json(`/api/users/${tech.id}/access`, { method: "PUT", body: { changes: { "jobs.view": false } } })).status).toBe(200);
    expect((await tech.json(`/api/jobs/${mine.data.id}`)).status).toBe(403);
    expect((await tech.json(`/api/jobs/${mine.data.id}/workbook`)).status).toBe(403);
    expect((await tech.json("/api/jobs?view=mine")).status).toBe(403);
  });

  it("a repeated job number on a change is refused, not a crash", async () => {
    const m = await person("scheduling");
    const a = await m.json("/api/jobs", { body: jobBody() });
    const b = await m.json("/api/jobs", { body: jobBody() });
    const job = (await m.json(`/api/jobs/${b.data.id}`)).data.job;
    const r = await m.json(`/api/jobs/${b.data.id}`, { method: "PATCH", body: { revision: job.revision, job_number: (await m.json(`/api/jobs/${a.data.id}`)).data.job.job_number } });
    expect(r.status).toBe(409);
  });

  it("keeps one-line fields on one line", async () => {
    const m = await person("scheduling");
    const r = await m.json("/api/jobs", { body: jobBody({ customer: "Acme\nBottling" }) });
    expect((await m.json(`/api/jobs/${r.data.id}`)).data.job.customer).toBe("Acme Bottling");
  });

  it("tells the engineers already on a job when its days change", async () => {
    emailOn();
    const m = await person("scheduling");
    const t1 = await person("tech");
    const r = await m.json("/api/jobs", { body: jobBody({ techIds: [t1.id] }) });
    const job = (await m.json(`/api/jobs/${r.data.id}`)).data.job;
    await m.json(`/api/jobs/${r.data.id}`, { method: "PATCH", body: { revision: job.revision, notes: "only notes" } });
    expect(sent).toHaveLength(1);
    await m.json(`/api/jobs/${r.data.id}`, { method: "PATCH", body: { revision: job.revision + 1, work_days: ["2026-12-09"] } });
    expect(sent).toHaveLength(2);
    expect(sent[1].subject).toMatch(/^Changed: job/);
  });

  it("lists my jobs and upcoming jobs", async () => {
    const m = await person("scheduling");
    const tech = await person("tech");
    const r = await m.json("/api/jobs", { body: jobBody({ techIds: [tech.id], work_days: ["2099-01-05"] }) });
    const mine = await tech.json("/api/jobs?view=mine");
    expect(mine.data.jobs.map((j: any) => j.id)).toContain(r.data.id);
    expect(mine.data.jobs[0].techs[0].name).toBe(tech.name);
    const past = await m.json("/api/jobs?view=past");
    expect(past.data.jobs.map((j: any) => j.id)).not.toContain(r.data.id);
  });
});

describe("Ronchi workbook: work orders", () => {
  it("shows the current work order with the log of past work orders for the machine", async () => {
    const m = await person("scheduling");
    const tech = await person("tech");
    const serial = `4${String(Math.floor(Math.random() * 900) + 100)}TP`;
    const old = await m.json("/api/jobs", { body: jobBody({ machine: serial, work_days: ["2025-03-01"], notes: "Replaced the star wheel." }) });
    const form = new FormData();
    form.append("files", new File(["old report"], "March report.pdf"));
    await m.form(`/api/jobs/${old.data.id}/files`, form);
    const cur = await m.json("/api/jobs", { body: jobBody({ machine: serial, techIds: [tech.id] }) });
    await m.json("/api/jobs", { body: jobBody({ machine: "4999ZZ" }) }); // another machine: not in the log
    const wb = await tech.json(`/api/jobs/${cur.data.id}/workbook`);
    expect(wb.status).toBe(200);
    expect(wb.data.job.id).toBe(cur.data.id);
    expect(wb.data.log.map((j: any) => j.id)).toEqual([old.data.id]);
    expect(wb.data.log[0].notes).toBe("Replaced the star wheel.");
    expect(wb.data.log[0].files.map((f: any) => f.name)).toEqual(["March report.pdf"]);
  });

  it("a switch removes the workbook; scheduling, emails and files keep working", async () => {
    emailOn();
    const admin = await person("admin");
    const m = await person("scheduling");
    const tech = await person("tech");
    expect((await m.json("/api/switches/workbook", { method: "PUT", body: { on: false } })).status).toBe(403);
    expect((await admin.json("/api/switches/workbook", { method: "PUT", body: { on: false } })).status).toBe(200);
    try {
      expect((await tech.json("/api/switches")).data.switches.workbook).toBe(false);
      const r = await m.json("/api/jobs", { body: jobBody({ techIds: [tech.id] }) });
      expect(r.status).toBe(200);
      expect(sent[0].text).toContain(`${env.ORIGIN}/jobs/${r.data.id}`);
      expect(sent[0].text).not.toContain("work-orders");
      expect((await tech.json(`/api/jobs/${r.data.id}/workbook`)).status).toBe(404);
      const form = new FormData();
      form.append("files", new File(["x"], "a.pdf"));
      expect((await tech.form(`/api/jobs/${r.data.id}/files`, form)).status).toBe(200);
      expect((await tech.json(`/api/jobs/${r.data.id}`)).status).toBe(200);
    } finally {
      await admin.json("/api/switches/workbook", { method: "PUT", body: { on: true } });
    }
  });
});
