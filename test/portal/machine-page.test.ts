// A machine's page brings together what the rest of the portal knows about that machine:
// its jobs (work orders), knowledge-base notes and parts catalog, each only for people allowed to see it.
import { describe, expect, it } from "vitest";
import { person } from "./helpers";

describe("the machine page", () => {
  it("lists the machine's jobs, its knowledge-base notes and its parts catalog sheets", async () => {
    const admin = await person("admin");
    const serial = `${4000 + Math.floor(Math.random() * 999)}MB`;
    const add = await admin.json("/api/machines", { body: { serial, customer: "Acme Bottling", site: "Pottstown" } });
    expect(add.status).toBe(200);
    const id = add.data.id ?? add.data.machine?.id;
    const job = await admin.json("/api/jobs", { body: { job_number: `J-${serial}`, customer: "Acme Bottling", machine: serial, work_days: ["2026-12-01"] } });
    expect(job.status).toBe(200);
    await admin.json("/api/jobs", { body: { job_number: `J-other-${serial}`, customer: "Acme Bottling", machine: "9999TP", work_days: ["2026-12-01"] } });
    await admin.json("/api/kb", { body: { kind: "quick_note", title: "Head slips", machine_type: "Capper", serial, issue: "Head slips", fix: "Tighten" } });

    const page = await admin.json(`/api/machines/${id}`);
    expect(page.status).toBe(200);
    expect(page.data.jobs.map((j: any) => j.job_number)).toEqual([`J-${serial}`]);
    expect(page.data.notes.map((n: any) => n.title)).toEqual(["Head slips"]);
    expect(page.data.catalog).toEqual({ sheets: 0 });
  });

  it("leaves out what the person's role can't see", async () => {
    const admin = await person("admin");
    const serial = `${5000 + Math.floor(Math.random() * 999)}TP`;
    const add = await admin.json("/api/machines", { body: { serial } });
    const id = add.data.id ?? add.data.machine?.id;
    const sales = await person("sales");
    const page = await sales.json(`/api/machines/${id}`);
    expect(page.status).toBe(200);
    // Sales sees jobs and the knowledge base by default; a custom role without them gets null.
    expect(Array.isArray(page.data.jobs)).toBe(true);
    const tech = await person("tech");
    const t = await tech.json(`/api/machines/${id}`);
    expect(t.data.orders).toBeNull();
  });
});
