import { describe, expect, it } from "vitest";
import { Browser, person } from "./helpers";

const DEAL = { customer: "Acme Labs", site: "Atlanta, GA", title: "24-head filler with capper", value: 1250000, expected_po: "2027-03", owner: "Andrew", next_step: "Send budget quote", next_step_date: "2026-12-10", machine: "4301tp" };

describe("machine sales", () => {
  it("sales and managers work deals; everyone on staff can see them; nobody signed out can", async () => {
    const sales = await person("sales");
    const r = await sales.json("/api/machine-sales", { body: DEAL });
    expect(r.status).toBe(200);
    expect(r.data.number).toMatch(/^M-\d{4,}$/);
    for (const role of ["manager", "admin", "billing", "scheduling", "service", "engineering", "tech"]) {
      expect((await (await person(role)).fetch(`/api/machine-sales/${r.data.id}`)).status, role).toBe(200);
    }
    for (const role of ["billing", "scheduling", "service", "engineering", "tech"]) {
      const p = await person(role);
      expect((await p.fetch("/api/machine-sales", { body: DEAL })).status, role).toBe(403);
      expect((await p.fetch(`/api/machine-sales/${r.data.id}`, { method: "PATCH", body: { revision: 1, owner: "Me" } })).status, role).toBe(403);
      expect((await p.fetch(`/api/machine-sales/${r.data.id}/notes`, { body: { body: "hi" } })).status, role).toBe(403);
      expect((await p.fetch(`/api/machine-sales/${r.data.id}`, { method: "DELETE" })).status, role).toBe(403);
    }
    expect((await new Browser().fetch("/api/machine-sales")).status).toBe(401);
  });

  it("never sends a deal's dollar value to someone without See deal values, and keeps it out of the history", async () => {
    const sales = await person("sales");
    const { data: made } = await sales.json("/api/machine-sales", { body: DEAL });
    expect((await sales.json(`/api/machine-sales/${made.id}`)).data.deal.value).toBe(1250000);
    for (const role of ["tech", "service", "engineering", "scheduling"]) {
      const p = await person(role);
      const one = (await p.json(`/api/machine-sales/${made.id}`)).data;
      expect("value" in one.deal, role).toBe(false);
      expect(JSON.stringify(one), role).not.toContain("1250000");
      const list = (await p.json("/api/machine-sales")).data.deals;
      expect(list.length).toBeGreaterThan(0);
      expect(JSON.stringify(list), role).not.toContain("1250000");
    }
    expect((await (await person("billing")).json(`/api/machine-sales/${made.id}`)).data.deal.value).toBe(1250000);
    await sales.json(`/api/machine-sales/${made.id}`, { method: "PATCH", body: { revision: 1, value: 1300000 } });
    const after = (await sales.json(`/api/machine-sales/${made.id}`)).data;
    expect(after.deal.value).toBe(1300000);
    expect(JSON.stringify(after.history)).not.toContain("1300000");
    expect(after.history[0].changes).toEqual({ value: [null, "changed"] });
  });

  it("numbers deals in turn and tidies what is typed", async () => {
    const sales = await person("sales");
    const a = await sales.json("/api/machine-sales", { body: DEAL });
    const b = await sales.json("/api/machine-sales", { body: { customer: "Beta Foods" } });
    expect(Number(b.data.number.slice(2))).toBe(Number(a.data.number.slice(2)) + 1);
    const { data } = await sales.json(`/api/machine-sales/${a.data.id}`);
    expect(data.deal).toMatchObject({ customer: "Acme Labs", machine: "4301TP", stage: "lead", funded: false, open: true, expected_po: "2027-03" });
    expect((await sales.fetch("/api/machine-sales", { body: { title: "No customer" } })).status).toBe(400);
    expect((await sales.fetch("/api/machine-sales", { body: { customer: "A", stage: "maybe" } })).status).toBe(400);
    expect((await sales.fetch("/api/machine-sales", { body: { customer: "A", expected_po: "next spring" } })).status).toBe(400);
    expect((await sales.fetch("/api/machine-sales", { body: { customer: "A", next_step_date: "soon" } })).status).toBe(400);
    expect((await sales.fetch("/api/machine-sales", { body: { customer: "A", value: -5 } })).status).toBe(400);
    expect((await sales.fetch("/api/machine-sales", { body: { customer: "A", chance: 140 } })).status).toBe(400);
  });

  it("moves through the stages: Won needs the PO, Lost a reason, On hold a date, and a held deal picks back up where it was", async () => {
    const sales = await person("sales");
    const { data: made } = await sales.json("/api/machine-sales", { body: DEAL });
    const url = `/api/machine-sales/${made.id}`;
    const patch = (body: Record<string, unknown>) => sales.json(url, { method: "PATCH", body });
    expect((await patch({ revision: 1, stage: "firm_quote" })).status).toBe(200);
    expect((await patch({ revision: 2, stage: "won" })).status).toBe(400);
    expect((await patch({ revision: 2, stage: "on_hold" })).status).toBe(400);
    expect((await patch({ revision: 2, stage: "lost" })).status).toBe(400);
    expect((await patch({ revision: 2, stage: "on_hold", hold_until: "2027-02-01" })).status).toBe(200);
    let d = (await sales.json(url)).data.deal;
    expect(d).toMatchObject({ stage: "on_hold", prev_stage: "firm_quote", hold_until: "2027-02-01" });
    expect((await patch({ revision: 3, stage: "lost", lost_reason: "Project cancelled" })).status).toBe(200);
    d = (await sales.json(url)).data.deal;
    expect(d).toMatchObject({ stage: "lost", prev_stage: "firm_quote", open: false });
    expect((await patch({ revision: 4, stage: "firm_quote" })).status).toBe(200);
    expect((await patch({ revision: 5, stage: "won", customer_po: "PO-9001" })).status).toBe(200);
    d = (await sales.json(url)).data.deal;
    expect(d).toMatchObject({ stage: "won", prev_stage: null, customer_po: "PO-9001" });
    expect(d.won_at).toBeTruthy();
    expect((await patch({ revision: 6, stage: "paid" })).status).toBe(200);
    d = (await sales.json(url)).data;
    expect(d.deal).toMatchObject({ stage: "paid", open: false });
    expect(d.deal.closed_at).toBeTruthy();
    expect(d.history.some((h: any) => h.changes?.stage?.[1] === "won")).toBe(true);
  });

  it("refuses a save made from an old copy", async () => {
    const sales = await person("sales");
    const { data: made } = await sales.json("/api/machine-sales", { body: DEAL });
    const url = `/api/machine-sales/${made.id}`;
    expect((await sales.fetch(url, { method: "PATCH", body: { revision: 1, owner: "Michele" } })).status).toBe(200);
    expect((await sales.fetch(url, { method: "PATCH", body: { revision: 1, owner: "Paolo" } })).status).toBe(409);
    expect((await sales.fetch(url, { method: "PATCH", body: { owner: "Paolo" } })).status).toBe(409);
  });

  it("logs calls and visits on the timeline, and removes a deal from the list", async () => {
    const sales = await person("sales");
    const { data: made } = await sales.json("/api/machine-sales", { body: DEAL });
    const url = `/api/machine-sales/${made.id}`;
    expect((await sales.fetch(`${url}/notes`, { body: { kind: "call", body: "Talked to purchasing." } })).status).toBe(200);
    expect((await sales.fetch(`${url}/notes`, { body: { kind: "fax", body: "x" } })).status).toBe(400);
    expect((await sales.fetch(`${url}/notes`, { body: { kind: "call", body: "  " } })).status).toBe(400);
    const { data } = await sales.json(url);
    expect(data.notes).toHaveLength(1);
    expect(data.notes[0]).toMatchObject({ kind: "call", body: "Talked to purchasing." });
    expect((await sales.fetch(url, { method: "DELETE" })).status).toBe(200);
    expect((await sales.fetch(url)).status).toBe(404);
    expect((await sales.json("/api/machine-sales")).data.deals.some((x: any) => x.id === made.id)).toBe(false);
  });

  it("shows the customer's machines in the field on the deal", async () => {
    const admin = await person("admin");
    await admin.json("/api/machines", { body: { serial: "4555TP", model: "EXACTA", customer: "acme labs", site: "Atlanta" } });
    const sales = await person("sales");
    const { data: made } = await sales.json("/api/machine-sales", { body: DEAL });
    const { data } = await sales.json(`/api/machine-sales/${made.id}`);
    expect(data.machines.map((m: any) => m.serial)).toContain("4555TP");
  });

  it("closes to everyone but admins when the section is switched off", async () => {
    const admin = await person("admin");
    const cur = await admin.json("/api/settings");
    const put = (on: boolean) => admin.json("/api/settings", { method: "PUT", body: { ...cur.data.settings, sections: { ...cur.data.settings.sections, machineSales: on } } });
    expect((await put(false)).status).toBe(200);
    expect((await (await person("sales")).fetch("/api/machine-sales")).status).toBe(403);
    expect((await admin.fetch("/api/machine-sales")).status).toBe(200);
    expect((await put(true)).status).toBe(200);
    expect((await (await person("sales")).fetch("/api/machine-sales")).status).toBe(200);
  });
});
