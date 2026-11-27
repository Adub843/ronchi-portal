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

  it("a keyword search brings up every document with any of the words, best matches first", async () => {
    const admin = await person("admin");
    await admin.json("/api/kb", { body: { kind: "howto", title: "Adjust the clutch preload", fix: "Turn the clutch nut a quarter turn" } });
    await admin.json("/api/kb", { body: { kind: "howto", title: "Torque check after a long run", fix: "Measure with the torque tester" } });
    await admin.json("/api/kb", { body: { kind: "known_issue", title: "Torque drift and clutch wear", issue: "Torque drops after hours", fix: "Re-grease the clutch" } });
    const titles = (await admin.json("/api/kb?q=torque%20clutch")).data.results.map((r: any) => r.title);
    expect(titles[0]).toBe("Torque drift and clutch wear");
    expect(titles).toEqual(expect.arrayContaining(["Adjust the clutch preload", "Torque check after a long run"]));
  });

  it("a machine number brings up that machine's notes, anything that names it, and the documents for its type", async () => {
    await env.DB.prepare("INSERT INTO machines (id, serial, model, customer, site, created_at, updated_at) VALUES ('m-mono', '4212MB', 'Monoblock filler and capper', 'Unilever', 'Atlanta', '2026-01-01', '2026-01-01')").run();
    const admin = await person("admin");
    const note = await admin.json("/api/kb", { body: { kind: "quick_note", title: "Infeed guide loose", serial: "4212MB", fix: "Tighten the guide" } });
    const named = await admin.json("/api/kb", { body: { kind: "reference", title: "Line layout", body: "Same layout as 4212MB." } });
    const filler = await admin.json("/api/kb", { body: { kind: "howto", title: "Filler nozzle cleaning", machine_type: "Filler" } });
    const general = await admin.json("/api/kb", { body: { kind: "reference", title: "Ronchi lubrication chart", machine_type: "General" } });
    const vision = await admin.json("/api/kb", { body: { kind: "howto", title: "Camera focus", machine_type: "Vision" } });
    const r = (await admin.json("/api/kb?q=4212MB")).data;
    const codes = r.results.map((x: any) => x.code);
    expect(codes.slice(0, 2)).toEqual([note.data.code, named.data.code]);
    expect(codes).toEqual(expect.arrayContaining([filler.data.code, general.data.code]));
    expect(codes).not.toContain(vision.data.code);
    expect(r.machine).toEqual({ serials: ["4212MB"], types: ["Monoblock", "Filler", "Capper", "General", "Controls and HMI"] });
    // The company name gives the same list.
    expect((await admin.json("/api/kb?q=unilever")).data.results.map((x: any) => x.code)).toEqual(codes);
  });

  it("filters by document type, machine and category, and counts what each filter would show", async () => {
    const admin = await person("admin");
    expect((await admin.json("/api/kb/import", { body: { documents: [SPEC, { ...SPEC, code: "RA-HOW-003", type: "HOW", title: "Set the filler recipe", machine: "Filler", meta: {}, issue: "", fix: "", audience: "I" }] } })).data).toEqual({ added: 2, updated: 0, skipped: 0, blocked: [] });
    const r = await admin.json("/api/kb?kind=known_issue");
    expect(r.data.results.map((x: any) => x.code)).toContain("RA-KI-001");
    expect(r.data.results.every((x: any) => x.kind === "known_issue")).toBe(true);
    expect(r.data.facets.kind.howto).toBeGreaterThanOrEqual(1);
    expect(r.data.facets.machine_type.Capper).toBeGreaterThanOrEqual(1);
    const cat = await admin.json("/api/kb?category=Electrical&machine_type=Capper");
    expect(cat.data.results.map((x: any) => x.code)).toContain("RA-KI-001");
    expect(cat.data.results.every((x: any) => x.category === "Electrical" && x.machine_type === "Capper")).toBe(true);
    // Importing again updates instead of making a copy.
    expect((await admin.json("/api/kb/import", { body: { documents: [SPEC] } })).data).toEqual({ added: 0, updated: 1, skipped: 0, blocked: [] });
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

  it("customers never see a customer's name or site: the help center copy has them hidden, staff still see them", async () => {
    // Aaron, 2026-11-25: "if its seen from a customers side sensor the names".
    connectHelpSite();
    await env.DB.prepare("INSERT INTO machines (id, serial, customer, site, created_at, updated_at) VALUES ('m-henkel', '3981MB', 'Henkel', 'Chattanooga', '2026-01-01', '2026-01-01')").run();
    const service = await person("service");
    const a = await service.json("/api/kb", { body: { kind: "known_issue", audience: "customer", title: "Torque drift on the ECAM at Henkel", issue: "Seen at HENKEL in Chattanooga", fix: "Re-grease the clutch" } });
    const pub = await service.json(`/api/kb/${a.data.id}/publish`, { body: {} });
    expect(pub.status).toBe(200);
    expect(pub.data.hidden.sort()).toEqual(["Chattanooga", "Henkel"]);
    const html = await helpPage(`/a/${a.data.code}`);
    expect(html).toContain("Torque drift on the ECAM at [customer]");
    expect(html).toContain("Seen at [customer] in [site]");
    expect(html).not.toMatch(/henkel|chattanooga/i);
    expect(await helpPage("/?q=henkel")).not.toContain(a.data.code);
    // Staff keep the whole article.
    expect((await service.json(`/api/kb/${a.data.id}`)).data.article.issue).toBe("Seen at HENKEL in Chattanooga");
    // Saying a name "isn't a customer" no longer lets it through to customers.
    await service.json(`/api/kb/${a.data.id}/publish`, { body: { notCustomer: ["Henkel"] } });
    expect(await helpPage(`/a/${a.data.code}`)).not.toMatch(/henkel/i);
  });

  it("a machine number still stops publishing, even when an editor says it's fine", async () => {
    connectHelpSite();
    const service = await person("service");
    const a = await service.json("/api/kb", { body: { kind: "known_issue", audience: "customer", title: "Torque drift on the ECAM", issue: "Seen on 3979MB", fix: "Re-grease the clutch", serial: "3979MB" } });
    const pub = await service.json(`/api/kb/${a.data.id}/publish`, { body: { notCustomer: ["3979MB"] } });
    expect(pub.status).toBe(409);
    expect(pub.data.hits.map((h: any) => h.found)).toEqual(["3979MB"]);
    expect(await helpPage(`/a/${a.data.code}`)).toContain("Article not found");
  });

  it("checks the machine type too, and a re-import that makes a document staff only takes it off the help center", async () => {
    connectHelpSite();
    const admin = await person("admin");
    const a = await admin.json("/api/kb", { body: { kind: "howto", audience: "customer", title: "Clean the cap chute", machine_type: "Henkel capper", fix: "Wipe the rails" } });
    expect((await admin.json(`/api/kb/${a.data.id}/publish`, { body: {} })).data.hidden).toEqual(["Henkel"]);
    expect(await helpPage(`/a/${a.data.code}`)).not.toMatch(/henkel/i);

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
    expect((await admin.json("/api/kb?q=scroll%20joint%20grease")).data.results.map((r: any) => r.code)).not.toContain(out.data.code);
    expect(await helpPage(`/a/${out.data.code}`)).toContain("Article not found");
  });

  it("dollar amounts and quote numbers never get into the knowledge base: import leaves the document out, saving is refused", async () => {
    const admin = await person("admin");
    const res = await admin.json("/api/kb/import", { body: { documents: [
      { ...SPEC, code: "RA-REF-901", type: "REF", title: "Service rates", summary: "Field service is $185 per hour." },
      { ...SPEC, code: "RA-REF-902", type: "REF", title: "Belt tension", summary: "Belt makers quote working load at 1% stretch." },
      { ...SPEC, code: "RA-REF-903", type: "REF", title: "Old order", fix: "See quote no. KS015 and 1,200 USD for the kit." },
    ] } });
    expect(res.status).toBe(200);
    expect(res.data.added).toBe(1);
    expect(res.data.blocked.map((b: any) => b.code)).toEqual(["RA-REF-901", "RA-REF-903"]);
    expect(res.data.blocked[0].found).toEqual(["$185"]);
    const add = await admin.json("/api/kb", { body: { kind: "quick_note", title: "Motor swap", machine_type: "Capper", issue: "Motor failed", fix: "New motor cost €950" } });
    expect(add.status).toBe(400);
    expect(add.data.error).toContain("dollar amounts or quotes");
    const ok = await admin.json("/api/kb", { body: { kind: "quick_note", title: "Motor swap", machine_type: "Capper", issue: "Motor failed", fix: "Fitted a new motor" } });
    expect(ok.status).toBe(200);
    const edit = await admin.json(`/api/kb/${ok.data.id}`, { method: "PATCH", body: { fix: "Invoice 27622 covers it" } });
    expect(edit.status).toBe(400);
  });
});
