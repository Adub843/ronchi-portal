// Knowledge base (Step 2): one search box with filters, articles with separate Issue and Fix parts,
// quick notes from the field, the Training Center documents, and the one-way Publish to the customer
// help center. Publishing runs the customer-data scan first and never sends the machine number.
import { Hono, type Context } from "hono";
import { randomId } from "../../shared/crypto";
import {
  cleanContent, CONFIRMABLE, contentText, FIRST_TEAM_NUMBER, guessCategory, HELP_KIND, isKbKind, isMachineNumber, machineTypesFor, KB_CATEGORIES, KB_CODE, KB_KINDS,
  KIND_FROM_CODE, scanForCustomerData, toFtsQuery, type KbContent, type KbKind, type PrivateTerms,
} from "../../shared/kb";
import type { AppEnv } from "../env";
import { audit, now } from "../lib/db";
import { helpCall } from "../lib/help-site";
import { body, fail, requirePerm, str } from "../lib/http";
import { can } from "../lib/roles";

export const kb = new Hono<AppEnv>();

interface Row {
  id: string; code: string; kind: KbKind; title: string; summary: string; machine_type: string | null; category: string | null;
  serial: string | null; issue: string; fix: string; content: string; body_text: string; audience: "internal" | "customer";
  published_at: string | null; scan_ok: string; created_by: string | null; updated_by: string | null; created_at: string; updated_at: string; archived_at: string | null;
}

const LIST_FIELDS = "a.id, a.code, a.kind, a.title, a.summary, a.machine_type, a.category, a.serial, a.issue, a.fix, a.audience, a.published_at, a.updated_at";
const FACETS = ["kind", "machine_type", "category"] as const;

// ---------- Search ----------

kb.get("/", async (c) => {
  requirePerm(c, "kb.view");
  const q = (c.req.query("q") ?? "").slice(0, 200);
  const want: Record<string, string> = {};
  for (const f of [...FACETS, "audience"]) {
    const v = (c.req.query(f) ?? "").trim();
    if (v) want[f] = v.slice(0, 80);
  }
  const serial = (c.req.query("serial") ?? "").trim().toUpperCase().slice(0, 12);

  // A machine number, or a customer's company or site name, in the box searches by machine:
  // that machine's notes first, then anything that names it, then every document for its machine type.
  let words = q.trim();
  const wanted = serial || (isMachineNumber(words) ? words.toUpperCase().replace("-", "") : "");
  let customer: { name: string; serials: string[] } | null = null;
  let machines: { serial: string; model: string | null; customer: string | null; site: string | null }[] = [];
  if (wanted) {
    machines = (await c.env.DB.prepare("SELECT serial, model, customer, site FROM machines WHERE upper(serial) = ?").bind(wanted).all<typeof machines[number]>()).results;
    if (!machines.length) machines = [{ serial: wanted, model: null, customer: null, site: null }];
    if (!serial) words = "";
  } else if (words.length >= 3) {
    machines = (await c.env.DB.prepare(
      `SELECT serial, model, customer, site FROM machines
        WHERE lower(trim(customer)) = lower(?1) OR lower(trim(site)) = lower(?1) OR (length(?1) >= 4 AND lower(customer) LIKE lower(?2) ESCAPE '\\')
        ORDER BY serial LIMIT 200`,
    ).bind(words, `${words.replace(/[%_\\]/g, (m) => "\\" + m)}%`).all<typeof machines[number]>()).results;
    if (machines.length) {
      const name = (machines.find((m) => m.customer?.trim().toLowerCase() === words.toLowerCase()) ?? machines.find((m) => m.customer) ?? machines[0]!)?.customer?.trim() ?? machines[0]!.site!.trim();
      customer = { name, serials: machines.map((m) => m.serial.toUpperCase()) };
      words = "";
    }
  }

  let rows: Row[];
  let machine: { serials: string[]; types: string[] } | null = null;
  if (machines.length) {
    const serials = new Set(machines.map((m) => m.serial.toUpperCase()));
    const types = [...new Set(machines.flatMap((m) => machineTypesFor(m.model)))];
    machine = { serials: [...serials], types };
    // Articles whose text names one of the machine numbers.
    const named = new Set<string>();
    for (const s of serials) {
      const { results } = await c.env.DB.prepare("SELECT a.id FROM kb_fts f JOIN kb_articles a ON a.rowid = f.rowid WHERE kb_fts MATCH ? AND a.archived_at IS NULL LIMIT 500")
        .bind(`"${s.toLowerCase()}"`).all<{ id: string }>();
      for (const r of results) named.add(r.id);
    }
    const all = (await c.env.DB.prepare(`SELECT ${LIST_FIELDS} FROM kb_articles a WHERE a.archived_at IS NULL ORDER BY a.updated_at DESC LIMIT 5000`).all<Row>()).results;
    const rank = (r: Row) => (serials.has((r.serial ?? "").toUpperCase()) ? 0 : named.has(r.id) ? 1 : r.machine_type && types.includes(r.machine_type) ? 2 : 9);
    rows = all.filter((r) => rank(r) < 9).sort((a, b) => rank(a) - rank(b) || types.indexOf(a.machine_type ?? "") - types.indexOf(b.machine_type ?? ""));
  } else {
    // Any of the words counts; articles with more of them, in the title or the issue, come first.
    const fts = toFtsQuery(words).split(" ").filter(Boolean).join(" OR ");
    rows = (fts
      ? await c.env.DB.prepare(
          `SELECT ${LIST_FIELDS} FROM kb_fts f JOIN kb_articles a ON a.rowid = f.rowid
            WHERE kb_fts MATCH ? AND a.archived_at IS NULL
            ORDER BY bm25(kb_fts, 4.0, 6.0, 3.0, 3.0, 3.0, 1.0, 4.0) LIMIT 1000`,
        ).bind(fts).all<Row>()
      : await c.env.DB.prepare(`SELECT ${LIST_FIELDS} FROM kb_articles a WHERE a.archived_at IS NULL ORDER BY a.updated_at DESC LIMIT 1000`).all<Row>()).results;
  }
  const base = rows;
  const keep = (r: Row, skip?: string) => Object.entries(want).every(([k, v]) => k === skip || String((r as any)[k] ?? "") === v);

  // Each filter counts what you'd see if you picked it, keeping the other filters you already picked.
  const facets: Record<string, Record<string, number>> = {};
  for (const f of [...FACETS, "audience"]) {
    const counts: Record<string, number> = {};
    for (const r of base) if (keep(r, f)) { const v = (r as any)[f]; if (v) counts[v] = (counts[v] ?? 0) + 1; }
    facets[f] = counts;
  }
  const results = base.filter((r) => keep(r)).slice(0, 200).map((r) => ({ ...r, issue: r.issue.slice(0, 240), fix: r.fix.slice(0, 240), summary: r.summary.slice(0, 240) }));
  return c.json({ results, total: base.filter((r) => keep(r)).length, facets, serial: wanted || null, customer, machine });
});

// ---------- One article ----------

async function load(c: Context<AppEnv>, id: string): Promise<Row> {
  const a = await c.env.DB.prepare("SELECT * FROM kb_articles WHERE id = ? AND archived_at IS NULL").bind(id).first<Row>();
  if (!a) fail(404, "Not found.");
  return a;
}

kb.get("/:id", async (c) => {
  const user = requirePerm(c, "kb.view");
  const a = await load(c, c.req.param("id"));
  const names = await c.env.DB.prepare("SELECT id, name FROM users WHERE id IN (?, ?)").bind(a.created_by, a.updated_by).all<{ id: string; name: string }>();
  const nameOf = (id: string | null) => names.results.find((n) => n.id === id)?.name ?? null;
  const { content, body_text: _b, ...rest } = a;
  return c.json({
    article: { ...rest, content: JSON.parse(content || "{}") as KbContent, created_by_name: nameOf(a.created_by), updated_by_name: nameOf(a.updated_by) },
    canEdit: canEdit(user, a),
    canPublish: can(user.role, "kb.publish"),
    changedSincePublish: !!a.published_at && a.updated_at > a.published_at,
  });
});

function canEdit(user: { id: string; role: Parameters<typeof can>[0] }, a: Pick<Row, "created_by">): boolean {
  return can(user.role, "kb.publish") || (can(user.role, "kb.write") && a.created_by === user.id);
}

// ---------- Add and change ----------

/** The fields anyone writing an article can set, cleaned. Missing fields stay as they are. */
function fields(b: Record<string, unknown>) {
  const out: Partial<Row> & { contentObj?: KbContent } = {};
  if ("title" in b) { const t = str(b.title, 200); if (!t) fail(400, "Give it a title."); out.title = t; }
  if ("summary" in b) out.summary = str(b.summary, 600) ?? "";
  if ("issue" in b) out.issue = str(b.issue, 8000) ?? "";
  if ("fix" in b) out.fix = str(b.fix, 8000) ?? "";
  if ("machine_type" in b) out.machine_type = str(b.machine_type, 60);
  if ("category" in b) {
    const cat = str(b.category, 40);
    if (cat && !(KB_CATEGORIES as readonly string[]).includes(cat)) fail(400, "Pick a category from the list.");
    out.category = cat;
  }
  if ("serial" in b) {
    const s = str(b.serial, 12)?.toUpperCase() ?? null;
    if (s && !isMachineNumber(s)) fail(400, "Use a machine number like 3069MB.");
    out.serial = s;
  }
  if ("audience" in b) {
    if (b.audience !== "internal" && b.audience !== "customer") fail(400, "Choose staff only or customers.");
    out.audience = b.audience;
  }
  if ("content" in b) out.contentObj = cleanContent(b.content);
  else if ("body" in b) {
    const text = str(b.body, 20000);
    out.contentObj = text ? { blocks: [{ text: text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean) }] } : {};
  }
  return out;
}

async function nextCode(db: D1Database, kind: KbKind): Promise<string> {
  const prefix = KB_KINDS[kind].prefix;
  const row = await db.prepare("SELECT MAX(CAST(substr(code, ?) AS INTEGER)) AS n FROM kb_articles WHERE code LIKE ?").bind(prefix.length + 2, `${prefix}-%`).first<{ n: number | null }>();
  const n = Math.max(FIRST_TEAM_NUMBER, (row?.n ?? 0) + 1);
  return `${prefix}-${String(n).padStart(3, "0")}`;
}

kb.post("/", async (c) => {
  const user = requirePerm(c, "kb.write");
  const b = await body(c);
  if (!isKbKind(b.kind)) fail(400, "Choose what kind of article this is.");
  if (!("title" in b)) fail(400, "Give it a title.");
  const f = fields(b);
  const content = f.contentObj ?? {};
  const id = randomId();
  const at = now();
  for (let attempt = 0; ; attempt++) {
    const code = await nextCode(c.env.DB, b.kind);
    try {
      await c.env.DB.prepare(
        `INSERT INTO kb_articles (id, code, kind, title, summary, machine_type, category, serial, issue, fix, content, body_text, audience, created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(id, code, b.kind, f.title!, f.summary ?? "", f.machine_type ?? null, f.category ?? guessCategory(f.title, f.issue, f.fix), f.serial ?? null,
        f.issue ?? "", f.fix ?? "", JSON.stringify(content), contentText(content), f.audience ?? "internal", user.id, user.id, at, at).run();
      await audit(c.env.DB, { userId: user.id, action: "kb.add", targetType: "kb", targetId: code, ip: c.get("ip") });
      return c.json({ id, code });
    } catch (e) {
      if (attempt < 2 && /UNIQUE/i.test(String(e))) continue; // someone took the same number at the same moment
      throw e;
    }
  }
});

kb.patch("/:id", async (c) => {
  const user = requirePerm(c, "kb.write");
  const a = await load(c, c.req.param("id"));
  if (!canEdit(user, a)) fail(403, "Only the person who wrote it or a knowledge base editor can change this.");
  const f = fields(await body(c));
  const content = f.contentObj ?? (JSON.parse(a.content || "{}") as KbContent);
  const next = { ...a, ...f };
  // A published article that is switched to staff only comes off the help center first.
  if (a.published_at && next.audience === "internal") {
    await helpCall(c.env, a.code);
    next.published_at = null;
  }
  // Words a publisher confirmed earlier were checked against the old text, so new text is checked afresh.
  const textChanged = (["title", "summary", "issue", "fix", "machine_type", "category"] as const).some((k) => next[k] !== a[k]) || contentText(content) !== a.body_text;
  await c.env.DB.prepare(
    `UPDATE kb_articles SET title = ?, summary = ?, machine_type = ?, category = ?, serial = ?, issue = ?, fix = ?, content = ?, body_text = ?, audience = ?,
       published_at = ?, scan_ok = ?, updated_by = ?, updated_at = ? WHERE id = ?`,
  ).bind(next.title, next.summary, next.machine_type, next.category, next.serial, next.issue, next.fix, JSON.stringify(content), contentText(content),
    next.audience, next.published_at, textChanged ? "[]" : a.scan_ok, user.id, now(), a.id).run();
  await audit(c.env.DB, { userId: user.id, action: "kb.edit", targetType: "kb", targetId: a.code, ip: c.get("ip") });
  return c.json({ ok: true });
});

kb.delete("/:id", async (c) => {
  const user = requirePerm(c, "kb.write");
  const a = await load(c, c.req.param("id"));
  if (!canEdit(user, a)) fail(403, "Only the person who wrote it or a knowledge base editor can remove this.");
  if (a.published_at) await helpCall(c.env, a.code);
  await c.env.DB.prepare("UPDATE kb_articles SET archived_at = ?, published_at = NULL, updated_by = ? WHERE id = ?").bind(now(), user.id, a.id).run();
  await audit(c.env.DB, { userId: user.id, action: "kb.remove", targetType: "kb", targetId: a.code, ip: c.get("ip") });
  return c.json({ ok: true });
});

// ---------- The one-way Publish to the customer help center ----------

/** Every customer, site and lettered machine number in the machine list, for the wall's check. */
async function knownTerms(db: D1Database): Promise<PrivateTerms> {
  const { results } = await db.prepare("SELECT customer, site, serial FROM machines").all<{ customer: string | null; site: string | null; serial: string }>();
  const list = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x && x.trim().length >= 3))];
  // A bare number (1022) would also match ordinary numbers in an article, so only lettered ones are listed.
  return { customers: list(results.map((m) => m.customer)), sites: list(results.map((m) => m.site)), serials: list(results.map((m) => (/[A-Z]/i.test(m.serial) ? m.serial : null))) };
}

/** The scan, less anything a publisher already confirmed for this article. */
async function scan(db: D1Database, a: Row, confirmed: string[]) {
  const ok = new Set(confirmed.map((w) => w.toLowerCase()));
  return scanForCustomerData(publicFields(a), await knownTerms(db))
    .filter((h) => !(CONFIRMABLE.has(h.what) && ok.has(h.found.toLowerCase())))
    .map((h) => ({ ...h, canConfirm: CONFIRMABLE.has(h.what) }));
}

kb.post("/:id/scan", async (c) => {
  requirePerm(c, "kb.view");
  const a = await load(c, c.req.param("id"));
  return c.json({ hits: await scan(c.env.DB, a, JSON.parse(a.scan_ok || "[]")) });
});

/** Exactly what the help center receives. The machine number and who wrote it never leave the portal. */
function publicFields(a: Row) {
  return { title: a.title, summary: a.summary, issue: a.issue, fix: a.fix, body: a.body_text, machine_type: a.machine_type ?? "", category: a.category ?? "" };
}

kb.post("/:id/publish", async (c) => {
  const user = requirePerm(c, "kb.publish");
  const a = await load(c, c.req.param("id"));
  if (a.audience !== "customer") fail(400, "This article is staff only. Mark it for customers first.");
  const pub = publicFields(a);
  // "notCustomer": words the publisher looked at and confirmed are not customer details, for this article only.
  const b = await body(c);
  const confirmed = [...new Set([
    ...(JSON.parse(a.scan_ok || "[]") as string[]),
    ...(Array.isArray(b.notCustomer) ? b.notCustomer.filter((w): w is string => typeof w === "string" && w.length <= 200).slice(0, 50) : []),
  ])];
  const hits = await scan(c.env.DB, a, confirmed);
  if (hits.length) {
    return c.json({ error: "Take out the customer details below, then publish again.", hits }, 409);
  }
  await helpCall(c.env, a.code, {
    kind: HELP_KIND[a.kind], title: pub.title, machine_type: pub.machine_type || null, category: pub.category || null,
    issue: pub.issue, fix: pub.fix, body: [pub.summary, pub.body].filter(Boolean).join("\n\n"),
  });
  const at = now();
  await c.env.DB.prepare("UPDATE kb_articles SET published_at = ?, scan_ok = ? WHERE id = ?").bind(at, JSON.stringify(confirmed), a.id).run();
  await audit(c.env.DB, { userId: user.id, action: "kb.publish", targetType: "kb", targetId: a.code, detail: confirmed.length ? { confirmedNotCustomer: confirmed } : undefined, ip: c.get("ip") });
  return c.json({ ok: true, published_at: at });
});

kb.post("/:id/unpublish", async (c) => {
  const user = requirePerm(c, "kb.publish");
  const a = await load(c, c.req.param("id"));
  await helpCall(c.env, a.code);
  await c.env.DB.prepare("UPDATE kb_articles SET published_at = NULL WHERE id = ?").bind(a.id).run();
  await audit(c.env.DB, { userId: user.id, action: "kb.unpublish", targetType: "kb", targetId: a.code, ip: c.get("ip") });
  return c.json({ ok: true });
});

// ---------- Import the Training Center documents ----------

kb.post("/import", async (c) => {
  const user = requirePerm(c, "kb.publish");
  const b = await body(c);
  const docs = Array.isArray(b.documents) ? b.documents.slice(0, 1000) : fail(400, "Choose the knowledge base JSON file.");
  let added = 0, updated = 0, skipped = 0;
  const at = now();
  const stmts: D1PreparedStatement[] = [];
  const rows = (await c.env.DB.prepare("SELECT upper(code) AS code, published_at FROM kb_articles").all<{ code: string; published_at: string | null }>()).results;
  const existing = new Set(rows.map((r) => r.code));
  const published = new Set(rows.filter((r) => r.published_at).map((r) => r.code));
  for (const raw of docs as Record<string, any>[]) {
    const code = String(raw?.code ?? "").toUpperCase();
    const kind = KIND_FROM_CODE[String(raw?.type ?? code.split("-")[1] ?? "").toUpperCase()];
    const title = typeof raw?.title === "string" ? raw.title.trim().slice(0, 200) : "";
    if (!KB_CODE.test(code) || !kind || !title) { skipped++; continue; }
    const content = cleanContent(raw);
    const s = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
    const summary = s(raw.summary, 600);
    const machine = s(raw.machine, 60) || null;
    const metaCat = s(raw.meta?.Category, 40);
    const category = (KB_CATEGORIES as readonly string[]).includes(metaCat) ? metaCat : guessCategory(title, summary, machine, s(raw.meta?.Area, 200));
    const audience = raw.audience === "C" || raw.audience === "customer" ? "customer" : "internal";
    const values = [kind, title, summary, machine, category, s(raw.issue, 8000), s(raw.fix, 8000), JSON.stringify(content), contentText(content), audience] as const;
    if (existing.has(code)) {
      // A published document that is now staff only comes off the help center first.
      if (audience === "internal" && published.has(code)) {
        await helpCall(c.env, code);
        stmts.push(c.env.DB.prepare("UPDATE kb_articles SET published_at = NULL WHERE code = ?").bind(code));
      }
      stmts.push(c.env.DB.prepare(
        `UPDATE kb_articles SET kind = ?, title = ?, summary = ?, machine_type = ?, category = ?, issue = ?, fix = ?, content = ?, body_text = ?, audience = ?,
           scan_ok = '[]', updated_by = ?, updated_at = ?, archived_at = NULL WHERE code = ?`,
      ).bind(...values, user.id, at, code));
      updated++;
    } else {
      existing.add(code);
      stmts.push(c.env.DB.prepare(
        `INSERT INTO kb_articles (kind, title, summary, machine_type, category, issue, fix, content, body_text, audience, id, code, created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(...values, randomId(), code, user.id, user.id, at, at));
      added++;
    }
  }
  for (let i = 0; i < stmts.length; i += 50) await c.env.DB.batch(stmts.slice(i, i + 50));
  await audit(c.env.DB, { userId: user.id, action: "kb.import", detail: { added, updated, skipped }, ip: c.get("ip") });
  return c.json({ added, updated, skipped });
});
