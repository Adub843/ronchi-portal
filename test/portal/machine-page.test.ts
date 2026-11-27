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

  it("shows the machine's past service projects from SharePoint, and sending the list twice adds nothing", async () => {
    const admin = await person("admin");
    const n = 6000 + Math.floor(Math.random() * 999);
    const add = await admin.json("/api/machines", { body: { serial: `${n}MB` } });
    const id = add.data.id ?? add.data.machine?.id;
    const base = "https://ronchiam.sharepoint.com/sites/SERVICE/Shared%20Documents/Service%20Projects%20Completed/Acme";
    const rows = [
      { customer: "Acme", project_no: "23-0139-W1", year: 2023, title: `23-0139-W1 - #${n}`, machines: [String(n)], reports: 2, url: `${base}/${n}-a` },
      { customer: "Acme", project_no: "21-0205-S1", year: 2021, title: "21-0205-S1 two machines", machines: [`${n}MB`, "9998TP"], reports: 0, url: `${base}/${n}-b` },
      { customer: "Acme", project_no: "22-0001-S1", year: 2022, title: "another machine", machines: ["9998"], reports: 1, url: `${base}/${n}-c` },
    ];
    const first = await admin.json("/api/machines/service-history/import", { body: { rows } });
    expect(first.status).toBe(200);
    expect(first.data.added).toBe(3);
    const again = await admin.json("/api/machines/service-history/import", { body: { rows } });
    expect(again.data.added).toBe(0);
    const page = await admin.json(`/api/machines/${id}`);
    expect(page.data.service.map((s: any) => s.project_no)).toEqual(["23-0139-W1", "21-0205-S1"]);
    expect(page.data.service[0].reports).toBe(2);
    const bad = await admin.json("/api/machines/service-history/import", { body: { rows: [{ customer: "Acme", title: "x", url: "https://example.com/x" }] } });
    expect(bad.status).toBe(400);
    const tech = await person("tech");
    expect((await tech.json("/api/machines/service-history/import", { body: { rows } })).status).toBe(403);
  });

  it("shows the machine's own software backups, and keeps them off the general Software shelf", async () => {
    const admin = await person("admin");
    const serial = `${7000 + Math.floor(Math.random() * 999)}MB`;
    const add = await admin.json("/api/machines", { body: { serial } });
    const id = add.data.id ?? add.data.machine?.id;
    const pkg = await admin.json("/api/software", { body: { name: `${serial} software backups`, machine: serial.toLowerCase() } });
    expect(pkg.status).toBe(200);
    const again = await admin.json("/api/software", { body: { name: "second try", machine: serial } });
    expect(again.data).toEqual({ id: pkg.data.id, existed: true });
    const link = await admin.json(`/api/software/${pkg.data.id}/links`, { body: { links: [{ url: "https://ronchiam.sharepoint.com/sites/MACHINE_MANUALS/Shared%20Documents/4200%20to%204299/X/SOFTWARE/plc.ACD", name: "plc.ACD" }] } });
    expect(link.status).toBe(200);
    const page = await admin.json(`/api/machines/${id}`);
    expect(page.data.software.map((p: any) => [p.name, p.files])).toEqual([[`${serial} software backups`, 1]]);
    const shelf = await admin.json("/api/software");
    expect(shelf.data.packages.some((p: any) => p.id === pkg.data.id)).toBe(false);
    expect((await admin.json("/api/software", { body: { name: "x", machine: "not a machine" } })).status).toBe(400);
  });
});
