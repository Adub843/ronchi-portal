import { env } from "cloudflare:workers";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { person } from "./helpers";
import { connectHelpSite, helpPage } from "./help-site";

// Seams under test: the staff API (/api/kb) and what a customer then sees on the help center.

const SPEC = {
  code: "RA-KI-001",
  type: "KI",
  title: "Bosch capper: intermittent SERCOS communication loss",
  summary: "Alarm 198 Capper SERCOS error during production, caused by a loose SERCOS RJ45 connector on a drive.",
  machine: "Capper",
  audience: "C",
  meta: { Machine: "Servo cappers with Bosch IndraDrive", Category: "Electrical" },
  issue: "During production the capper faults with **Alarm 198, Capper SERCOS error**.",
  fix: "Find the drive where the ring stops. Reseat or replace the loose RJ45 on the hybrid SERCOS cable.",
  blocks: [{ heading: "How it was found", bullets: ["All SERCOS cables checked.", "A loose connection was found at the drive's control unit connector."] }],
};

beforeAll(async () => {
  await env.DB.prepare("INSERT INTO machines (id, serial, model, customer, site, created_at, updated_at) VALUES ('m-kb', '3979MB', 'EXACTA', 'Henkel', 'West Hazleton', '2026-01-01', '2026-01-01')").run();
});
afterEach(() => connectHelpSite(false));

describe("knowledge base", () => {
  it("a tech adds a quick note from a machine and anyone finds it by describing the problem", async () => {
    const tech = await person("tech");
    const add = await tech.json("/api/kb", { body: { kind: "quick_note", title: "Starwheel jams at changeover", machine_type: "Filler", category: "Changeover", serial: "3979MB", issue: "Bottles jam on the infeed starwheel after a size change", fix: "Reset the starwheel phase from the HMI before the first run" } });
    expect(add.status).toBe(200);
    expect(add.data.code).toMatch(/^RA-QN-5\d\d$/);

    const sales = await person("sales");
    const found = await sales.json("/api/kb?q=bottles%20jamming%20starwheel");
    expect(found.data.results.map((r: any) => r.code)).toContain(add.data.code);
    const bySerial = await sales.json("/api/kb?serial=3979mb");
    expect(bySerial.data.results.map((r: any) => r.code)).toEqual([add.data.code]);
  });

  it("searching a customer's company name finds the notes from that customer's machines", async () => {
    const tech = await person("tech");
    const note = await tech.json("/api/kb", { body: { kind: "quick_note", title: "Guide rail bolts loosen", machine_type: "Capper", serial: "3979MB", issue: "Guide rail drifts", fix: "Thread-lock the bolts" } });
    const r = await tech.json("/api/kb?q=henkel");
    expect(r.data.customer).toEqual({ name: "Henkel", serials: ["3979MB"] });
    expect(r.data.results.map((x: any) => x.code)).toContain(note.data.code);
    // A plain word search still works when no customer has that name.
    expect((await tech.json("/api/kb?q=thread%20lock")).data.customer).toBeNull();
  });

  it("filters by document type, machine and category, and counts what each filter would show", async () => {
    const admin = await person("admin");
    expect((await admin.json("/api/kb/import", { body: { documents: [SPEC, { ...SPEC, code: "RA-HOW-003", type: "HOW", title: "Set the filler recipe", machine: "Filler", meta: {}, issue: "", fix: "", audience: "I" }] } })).data).toEqual({ added: 2, updated: 0, skipped: 0 });
    const r = await admin.json("/api/kb?kind=known_issue");
    expect(r.data.results.map((x: any) => x.code)).toEqual(["RA-KI-001"]);
    expect(r.data.facets.kind.howto).toBeGreaterThanOrEqual(1);
    expect(r.data.facets.machine_type.Capper).toBeGreaterThanOrEqual(1);
    const cat = await admin.json("/api/kb?category=Electrical&machine_type=Capper");
    expect(cat.data.results.map((x: any) => x.code)).toEqual(["RA-KI-001"]);
    // Importing again updates instead of making a copy.
    expect((await admin.json("/api/kb/import", { body: { documents: [SPEC] } })).data).toEqual({ added: 0, updated: 1, skipped: 0 });
  });

  it("only editors import, and people change only their own articles", async () => {
    const tech = await person("tech");
    expect((await tech.json("/api/kb/import", { body: { documents: [SPEC] } })).status).toBe(403);
    const other = await person("tech");
    const mine = await tech.json("/api/kb", { body: { kind: "quick_note", title: "Cap chute sensor dirty", issue: "Low cap alarm with a full chute", fix: "Clean the sensor lens" } });
    expect((await other.json(`/api/kb/${mine.data.id}`, { method: "PATCH", body: { title: "x" } })).status).toBe(403);
    expect((await tech.json(`/api/kb/${mine.data.id}`, { method: "PATCH", body: { fix: "Clean the sensor lens with a dry cloth" } })).status).toBe(200);
    const read = await other.json(`/api/kb/${mine.data.id}`);
    expect(read.data.article.fix).toBe("Clean the sensor lens with a dry cloth");
  });

  it("publishing to customers is refused while the article names a customer, site or machine", async () => {
    connectHelpSite();
    const service = await person("service");
    const a = await service.json("/api/kb", { body: { kind: "known_issue", audience: "customer", title: "Torque drift on the ECAM", issue: "Seen at Henkel on 3979MB", fix: "Re-grease the clutch", serial: "3979MB" } });
    const pub = await service.json(`/api/kb/${a.data.id}/publish`, { body: {} });
    expect(pub.status).toBe(409);
    expect(pub.data.hits.map((h: any) => h.found).sort()).toEqual(["3979MB", "Henkel"]);
    expect(await helpPage(`/a/${a.data.code}`)).toContain("Article not found");
    // A machine number can't be waved through, even by an editor.
    expect((await service.json(`/api/kb/${a.data.id}/publish`, { body: { notCustomer: ["Henkel", "3979MB"] } })).data.hits.map((h: any) => h.found)).toEqual(["3979MB"]);
  });

  it("an editor can confirm a word is not a customer (a customer called Method, the word method)", async () => {
    connectHelpSite();
    await env.DB.prepare("INSERT INTO machines (id, serial, customer, created_at, updated_at) VALUES ('m-method', '4100TP', 'Method', '2026-01-01', '2026-01-01')").run();
    const service = await person("service");
    const a = await service.json("/api/kb", { body: { kind: "howto", audience: "customer", title: "Back up the HMI", body: "Method 1: copy the project to a USB stick." } });
    const first = await service.json(`/api/kb/${a.data.id}/publish`, { body: {} });
    expect(first.data.hits).toEqual([{ what: "Customer or site", found: "Method", field: "body", canConfirm: true }]);
    expect((await service.json(`/api/kb/${a.data.id}/publish`, { body: { notCustomer: ["Method"] } })).status).toBe(200);
    expect(await helpPage(`/a/${a.data.code}`)).toContain("copy the project to a USB stick");
  });

  it("checks the machine type too, and a re-import that makes a document staff only takes it off the help center", async () => {
    connectHelpSite();
    const admin = await person("admin");
    const a = await admin.json("/api/kb", { body: { kind: "howto", audience: "customer", title: "Clean the cap chute", machine_type: "Henkel capper", fix: "Wipe the rails" } });
    expect((await admin.json(`/api/kb/${a.data.id}/publish`, { body: {} })).data.hits).toEqual([{ what: "Customer or site", found: "Henkel", field: "machine_type", canConfirm: true }]);

    const doc = { ...SPEC, code: "RA-HOW-040", type: "HOW", title: "Set the infeed scroll height", issue: "", fix: "Raise the scroll to the bottle shoulder", meta: {} };
    await admin.json("/api/kb/import", { body: { documents: [doc] } });
    const id = (await admin.json("/api/kb?q=infeed%20scroll%20height")).data.results[0].id;
    expect((await admin.json(`/api/kb/${id}/publish`, { body: {} })).status).toBe(200);
    expect(await helpPage("/a/RA-HOW-040")).toContain("bottle shoulder");
    await admin.json("/api/kb/import", { body: { documents: [{ ...doc, audience: "I" }] } });
    expect(await helpPage("/a/RA-HOW-040")).toContain("Article not found");
  });

  it("a clean customer article reaches the help center without its machine number, and can be taken down", async () => {
    connectHelpSite();
    const service = await person("service");
    const a = await service.json("/api/kb", { body: { kind: "known_issue", audience: "customer", title: "Torque drift on the ECAM", machine_type: "Capper", issue: "Cap torque slowly drops after two hours", fix: "Re-grease the magnetic clutch", serial: "3979MB" } });
    const tech = await person("tech");
    expect((await tech.json(`/api/kb/${a.data.id}/publish`, { body: {} })).status).toBe(403);

    expect((await service.json(`/api/kb/${a.data.id}/publish`, { body: {} })).status).toBe(200);
    const html = await helpPage(`/a/${a.data.code}`);
    expect(html).toContain("Re-grease the magnetic clutch");
    expect(html).not.toContain("3979MB");
    expect(await helpPage("/?q=torque%20drops")).toContain(a.data.code);

    expect((await service.json(`/api/kb/${a.data.id}/unpublish`, { body: {} })).status).toBe(200);
    expect(await helpPage(`/a/${a.data.code}`)).toContain("Article not found");
  });

  it("staff-only articles can't be published, and archived articles leave search and the help center", async () => {
    connectHelpSite();
    const admin = await person("admin");
    const inside = await admin.json("/api/kb", { body: { kind: "reference", title: "Remote support logins", body: "Ask the service lead" } });
    expect((await admin.json(`/api/kb/${inside.data.id}/publish`, { body: {} })).status).toBe(400);

    const out = await admin.json("/api/kb", { body: { kind: "opl", audience: "customer", title: "Grease the scroll U-joint", fix: "Use food-grade grease weekly" } });
    await admin.json(`/api/kb/${out.data.id}/publish`, { body: {} });
    expect((await admin.json(`/api/kb/${out.data.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await admin.json("/api/kb?q=scroll%20joint%20grease")).data.results).toEqual([]);
    expect(await helpPage(`/a/${out.data.code}`)).toContain("Article not found");
  });
});
