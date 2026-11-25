// Knowledge base: one search box with filters down the side (document type, machine, category,
// who sees it), articles with separate Issue and Fix parts, quick notes from the field, and the
// one-way Publish to the customer help center after the customer-data scan.
import { useRef, useState } from "react";
import { api, can, fmtTime, type Me } from "../api";
import { t } from "../i18n";
import { Empty, ErrorNote, Link, toast, useLoad, Tip } from "../components/ui";
import { navigate } from "../router";
import { SoftwareManage, SoftwareShelf } from "./Software";

const KINDS: Record<string, string> = {
  opl: "One Point Lesson", howto: "How-to", known_issue: "Known issue", quick_note: "Quick note",
  reference: "Reference", training: "Training", verification: "Trainee verification",
};
const CATEGORIES = ["Mechanical", "Electrical", "Software", "Changeover"];
const MACHINE_TYPES = ["Filler", "Capper", "Monoblock", "Unscrambler", "Cap sorter", "Rotomatic", "Flowmeters", "Vision", "Controls and HMI", "Remote support", "General"];
const AUDIENCE: Record<string, string> = { internal: "Staff only", customer: "Customers" };

type Facets = Record<string, Record<string, number>>;

export function KnowledgeBase({ me }: { me: Me }) {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const params = new URLSearchParams({ q: query, ...filters }).toString();
  const { data, error, reload } = useLoad(() => api(`/kb?${params}`), [params], { live: true });
  const file = useRef<HTMLInputElement>(null);
  const [showFilters, setShowFilters] = useState(false);

  function pick(facet: string, value: string) {
    setFilters((f) => {
      const next = { ...f };
      if (next[facet] === value) delete next[facet];
      else next[facet] = value;
      return next;
    });
  }

  async function importFile(f: File | undefined) {
    if (!f) return;
    try {
      const json = JSON.parse(await f.text());
      const r = await api("/kb/import", { body: { documents: Array.isArray(json) ? json : json.documents } });
      toast(t("{a} added, {u} updated, {s} skipped", { a: r.added, u: r.updated, s: r.skipped }));
      reload();
    } catch (e) {
      toast(e instanceof SyntaxError ? t("That file isn't a knowledge base JSON file.") : (e as Error).message);
    }
    if (file.current) file.current.value = "";
  }

  const facets: Facets = data?.facets ?? {};
  const groups: { key: string; title: string; label: (v: string) => string; order?: string[] }[] = [
    { key: "kind", title: t("Document type"), label: (v) => t(KINDS[v] ?? v), order: Object.keys(KINDS) },
    { key: "machine_type", title: t("Machine"), label: (v) => v },
    { key: "category", title: t("Category"), label: (v) => t(v), order: CATEGORIES },
    { key: "audience", title: t("Who sees it"), label: (v) => t(AUDIENCE[v] ?? v), order: ["internal", "customer"] },
  ];

  return (
    <>
      <section className="kbhero">
        <h1>{t("Knowledge base")}</h1>
        <p className="kb-sub">{t("One Point Lessons, how-tos, known issues and quick notes from the field. Search by the problem, the fix, a machine number or a customer.")}</p>
        <form className="search" role="search" onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); }}>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Type any words, a machine number like 3979MB, or a customer name")} aria-label={t("Search the knowledge base")} maxLength={200} />
          <button className="btn primary" type="submit">{t("Search")}</button>
        </form>
      </section>

      <div className="row kb-actions">
        {can(me, "kb.write") && <button className="btn primary" onClick={() => navigate("/kb/new-note")}>{t("Add a quick note")}</button>}
        {can(me, "kb.write") && <button className="btn" onClick={() => navigate("/kb/new")}>{t("New article")}</button>}
        {can(me, "kb.import") && (
          <>
            <button className="btn" onClick={() => file.current?.click()}>{t("Import documents (JSON)")}</button>
            <input ref={file} type="file" accept=".json,application/json" hidden onChange={(e) => importFile(e.target.files?.[0])} />
          </>
        )}
      </div>

      <SoftwareShelf me={me} />

      <ErrorNote error={error} />
      {data?.machine && (
        <p className="note-inline kb-found">
          {data.customer
            ? t("Everything for {name}'s machines ({list}): their notes first, then anything that names them, then documents for their machine types.", { name: data.customer.name, list: data.machine.serials.join(", ") })
            : t("Everything for machine {serial}: its notes first, then anything that names it, then documents for its machine type.", { serial: data.machine.serials.join(", ") })}
          {" "}
          {data.machine.types.length
            ? t("Machine types: {types}.", { types: data.machine.types.join(", ") })
            : t("Its model isn't in the machine list yet, so documents for its machine type can't be added. Add the model on the machine's page.")}
        </p>
      )}

      <button className="btn touch-filters" aria-expanded={showFilters} onClick={() => setShowFilters(!showFilters)}>
        {t("Filters")}{Object.keys(filters).length ? ` (${Object.keys(filters).length})` : ""}
      </button>
      <div className="kb">
        <aside className={`facet panel${showFilters ? " open" : ""}`} aria-label={t("Filters")}>
          {groups.map((g) => {
            const counts = facets[g.key] ?? {};
            const values = Object.keys(counts).sort((a, b) => {
              const ia = g.order?.indexOf(a) ?? -1, ib = g.order?.indexOf(b) ?? -1;
              return ia >= 0 && ib >= 0 ? ia - ib : (counts[b] ?? 0) - (counts[a] ?? 0) || a.localeCompare(b);
            });
            if (!values.length && !filters[g.key]) return null;
            return (
              <div key={g.key}>
                <h3>{g.title}</h3>
                {values.map((v) => (
                  <label key={v}>
                    <span className="facet-name"><input type="checkbox" checked={filters[g.key] === v} onChange={() => pick(g.key, v)} /> {g.label(v)}</span>
                    <span>{counts[v]}</span>
                  </label>
                ))}
              </div>
            );
          })}
          {Object.keys(filters).length > 0 && <button className="linkish" onClick={() => setFilters({})}>{t("Clear filters")}</button>}
        </aside>

        <div className="panel kb-results">
          {data && <p className="muted small-note">{t("{n} articles", { n: data.total })}</p>}
          {data && !data.results.length && (
            <Empty>{query || Object.keys(filters).length ? t("Nothing matched. Try fewer or different words.") : t("No articles yet. Import the Training Center documents or add a quick note.")}</Empty>
          )}
          {data?.results.map((r: any) => (
            <div className="result" key={r.id}>
              <Link to={`/kb/${r.id}`}>{r.title}</Link>
              <div className="meta">
                <span className={`pill ${r.kind === "known_issue" || r.kind === "quick_note" ? "p-warn" : "p-info"}`}>{t(KINDS[r.kind] ?? r.kind)}</span>
                <span className="mono">{r.code}</span>
                {r.machine_type && <span>{r.machine_type}</span>}
                {r.category && <span>{t(r.category)}</span>}
                {r.serial && <span className="mono">{r.serial}</span>}
                {r.published_at ? <span className="pill p-ok">{t("On the help center")}</span> : r.audience === "customer" ? <span className="pill">{t("For customers")}</span> : null}
              </div>
              {(r.issue || r.summary) && <p className="kb-snip">{r.issue || r.summary}</p>}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ---------- One article ----------

export function KbArticle({ id, me }: { id: string; me: Me }) {
  if (id === "software") return <SoftwareManage me={me} />;
  if (id === "new" || id === "new-note") return <KbEditor me={me} quickNote={id === "new-note"} />;
  return <KbView id={id} me={me} />;
}

function KbView({ id, me }: { id: string; me: Me }) {
  const { data, error, reload } = useLoad(() => api(`/kb/${encodeURIComponent(id)}`), [id], { live: true });
  // The names customers won't see in this article (they get [customer] or [site] instead).
  const forCustomers = data?.article?.audience === "customer";
  const preview = useLoad(() => (forCustomers ? api(`/kb/${encodeURIComponent(id)}/scan`, { body: {} }) : Promise.resolve(null)), [id, forCustomers, data?.article?.updated_at]);
  const hiddenNames: string[] = preview.data?.hidden ?? [];
  const [editing, setEditing] = useState(false);
  const [sure, setSure] = useState(false);
  const [hits, setHits] = useState<any[] | null>(null);
  const [ok, setOk] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  if (error) return <ErrorNote error={error} />;
  if (!data) return null;
  const a = data.article;
  if (editing) return <KbEditor me={me} article={a} onDone={() => { setEditing(false); reload(); }} />;

  async function publish() {
    setBusy(true);
    try {
      const r = await api(`/kb/${a.id}/publish`, { body: { notCustomer: ok } });
      setHits(null);
      toast(r?.hidden?.length ? t("Published to the customer help center. Customer names hidden: {n}", { n: r.hidden.length }) : t("Published to the customer help center"));
      reload();
    } catch (e) {
      const r = await api(`/kb/${a.id}/scan`, { body: {} }).catch(() => null);
      if (r?.hits?.length) setHits(r.hits);
      toast((e as Error).message);
    }
    setBusy(false);
  }
  async function act(path: string, done: string) {
    setBusy(true);
    try {
      await api(`/kb/${a.id}/${path}`, { body: {} });
      toast(done);
      reload();
    } catch (e) {
      toast((e as Error).message);
    }
    setBusy(false);
  }
  async function remove() {
    if (!sure) return setSure(true);
    try {
      await api(`/kb/${a.id}`, { method: "DELETE" });
      toast(t("Removed"));
      navigate("/kb");
    } catch (e) {
      toast((e as Error).message);
    }
  }

  const content = a.content ?? {};
  return (
    <article className="kb-article">
      <div className="pagehead row">
        <div className="kb-head">
          <div className="meta row kb-tags">
            <span className={`pill ${a.kind === "known_issue" || a.kind === "quick_note" ? "p-warn" : "p-info"}`}>{t(KINDS[a.kind] ?? a.kind)}</span>
            <span className="mono">{a.code}</span>
            {a.machine_type && <span>{a.machine_type}</span>}
            {a.category && <span>{t(a.category)}</span>}
            {a.serial && <span className="mono">{a.serial}</span>}
            <span className={`pill ${a.audience === "customer" ? "p-ok" : ""}`}>{t(AUDIENCE[a.audience] ?? a.audience)}</span>
          </div>
          <h1>{a.title}</h1>
          {a.summary && <p className="kb-summary">{a.summary}</p>}
        </div>
        <div className="row kb-buttons">
          {data.canEdit && <button className="btn" onClick={() => setEditing(true)}>{t("Edit")}</button>}
          {data.canPublish && a.audience === "customer" && (
            <button className="btn primary" disabled={busy} onClick={publish}>
              {a.published_at ? (data.changedSincePublish ? t("Publish changes") : t("Publish again")) : t("Publish to help center")}
            </button>
          )}
          {data.canPublish && a.published_at && <button className="btn" disabled={busy} onClick={() => act("unpublish", t("Taken off the help center"))}>{t("Take off help center")}</button>}
          {data.canEdit && <button className="btn danger" onClick={remove}>{sure ? t("Yes, remove") : t("Remove")}</button>}
        </div>
      </div>

      {a.published_at && (
        <p className="note-inline">
          {data.changedSincePublish ? t("Changed since it was published on {when}. Customers still see the earlier version.", { when: fmtTime(a.published_at) }) : t("On the customer help center since {when}.", { when: fmtTime(a.published_at) })}
        </p>
      )}

      {data.canPublish && hiddenNames.length > 0 && (
        <p className="note-inline">
          {t("Customers see [customer] or [site] in place of these names: {names}. Staff see the whole article.", { names: hiddenNames.join(", ") })}
        </p>
      )}

      {hits && (
        <div className="panel kb-hits" role="alert">
          <h2>{t("Customer details found")}</h2>
          <p className="muted">{t("Machine numbers and passwords must come out before customers can see this. Tick an email address or phone number only if it is Ronchi's own.")}</p>
          <ul>
            {hits.map((h, i) => (
              <li key={i}>
                {h.canConfirm ? (
                  <label><input type="checkbox" checked={ok.includes(h.found)} onChange={() => setOk(ok.includes(h.found) ? ok.filter((w) => w !== h.found) : [...ok, h.found])} /> <strong>{h.found}</strong> <span className="muted">{t(h.what)} · {t(FIELD[h.field] ?? h.field)} · {t("Ronchi's own, OK to show")}</span></label>
                ) : (
                  <span><strong>{h.found}</strong> <span className="muted">{t(h.what)} · {t(FIELD[h.field] ?? h.field)} · {t("must be taken out")}</span></span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {(a.issue || a.fix) && (
        <div className="kb-issuefix">
          {a.issue && <section className="panel kb-issue"><h2>{t("Issue")}</h2><Rich text={a.issue} /></section>}
          {a.fix && <section className="panel kb-fix"><h2>{t("Fix")}</h2><Rich text={a.fix} /></section>}
        </div>
      )}

      {content.meta && (
        <dl className="panel kb-meta">
          {Object.entries(content.meta as Record<string, string>).map(([k, v]) => (<div key={k}><dt>{k}</dt><dd>{v}</dd></div>))}
        </dl>
      )}
      {content.safety?.length > 0 && (
        <section className="panel kb-safety"><h2>{t("Safety")}</h2><ul>{content.safety.map((s: string, i: number) => <li key={i}><Rich text={s} /></li>)}</ul></section>
      )}
      {content.tools?.length > 0 && (
        <section className="panel"><h2>{t("Tools and parts")}</h2><ul>{content.tools.map((s: string, i: number) => <li key={i}>{s}</li>)}</ul></section>
      )}
      {(content.blocks ?? []).map((b: any, i: number) => <Block key={i} b={b} />)}

      <p className="muted small-note">
        {t("Written by {who}", { who: a.created_by_name ?? t("Ronchi America") })} · {t("Updated {when}", { when: fmtTime(a.updated_at) })}
        {a.updated_by_name && a.updated_by_name !== a.created_by_name ? ` · ${a.updated_by_name}` : ""}
      </p>
    </article>
  );
}

const FIELD: Record<string, string> = { title: "Title", summary: "Summary", issue: "Issue", fix: "Fix", body: "Details" };

/** Text with **bold** marks, shown as text (never as code). */
function Rich({ text }: { text: string }) {
  return (
    <span className="kb-text">
      {text.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (/^\*\*[^*]+\*\*$/.test(p) ? <strong key={i}>{p.slice(2, -2)}</strong> : p))}
    </span>
  );
}

function Callouts({ list }: { list?: { kind?: string; label?: string; text: string }[] }) {
  if (!list?.length) return null;
  return (
    <>
      {list.map((c, i) => (
        <p key={i} className={`kb-callout ${c.kind === "warning" || c.kind === "danger" ? "warn" : ""}`}><strong>{c.label ?? t("Note")}</strong> <Rich text={c.text} /></p>
      ))}
    </>
  );
}

function Block({ b }: { b: any }) {
  return (
    <section className="panel kb-block">
      {b.heading && <h2>{b.heading}</h2>}
      {(b.text ?? []).map((p: string, i: number) => <p key={i}><Rich text={p} /></p>)}
      {b.bullets?.length > 0 && <ul>{b.bullets.map((x: string, i: number) => <li key={i}><Rich text={x} /></li>)}</ul>}
      {b.steps?.length > 0 && (
        <ol className="kb-steps">
          {b.steps.map((s: any, i: number) => (
            <li key={i}>
              {s.title && <h3>{s.title}</h3>}
              {(s.text ?? []).map((p: string, j: number) => <p key={j}><Rich text={p} /></p>)}
              <Callouts list={s.callouts} />
            </li>
          ))}
        </ol>
      )}
      {b.table && (
        <div className="tbl kb-table">
          <table>
            {b.table.cols?.length > 0 && <thead><tr>{b.table.cols.map((c: string, i: number) => <th key={i}>{c}</th>)}</tr></thead>}
            <tbody>{b.table.rows.map((r: string[], i: number) => <tr key={i}>{r.map((c, j) => <td key={j}><Rich text={c} /></td>)}</tr>)}</tbody>
          </table>
        </div>
      )}
      <Callouts list={b.callouts} />
    </section>
  );
}

// ---------- Add or change ----------

/** True when the article's details are one plain block of text, so they can be edited here. */
function plainDetails(content: any): string | null {
  const blocks = content?.blocks ?? [];
  if (content?.meta || content?.safety || content?.tools) return null;
  if (!blocks.length) return "";
  if (blocks.length === 1 && Object.keys(blocks[0]).every((k) => k === "text")) return (blocks[0].text ?? []).join("\n\n");
  return null;
}

function KbEditor({ me, article, quickNote, onDone }: { me: Me; article?: any; quickNote?: boolean; onDone?: () => void }) {
  const details = article ? plainDetails(article.content) : "";
  const [f, setF] = useState({
    kind: article?.kind ?? (quickNote ? "quick_note" : "howto"),
    title: article?.title ?? "", summary: article?.summary ?? "", machine_type: article?.machine_type ?? "",
    category: article?.category ?? "", serial: article?.serial ?? "", issue: article?.issue ?? "", fix: article?.fix ?? "",
    audience: article?.audience ?? "internal", body: details ?? "",
  });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const note = f.kind === "quick_note";

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const { body, kind, ...rest } = f;
    const payload: Record<string, unknown> = { ...rest };
    if (details !== null) payload.body = body;
    try {
      if (article) {
        await api(`/kb/${article.id}`, { method: "PATCH", body: payload });
        toast(t("Saved"));
        onDone?.();
      } else {
        const r = await api("/kb", { body: { ...payload, kind } });
        navigate(`/kb/${r.id}`);
      }
    } catch (x) {
      setErr((x as Error).message);
    }
  }

  return (
    <>
      <div className="pagehead">
        <h1>{article ? t("Edit {code}", { code: article.code }) : note ? t("Add a quick note") : t("New article")}</h1>
        {note && !article && <Tip id="kb.quick-note">{t("A short Issue and Fix from the field, so the next field service engineer who hits it finds the answer.")}</Tip>}
      </div>
      <form className="panel stack kb-form" onSubmit={save}>
        <div className="grid g2">
          {!article && (
            <div className="field">
              <label htmlFor="kb-kind">{t("Type")}</label>
              <select id="kb-kind" value={f.kind} onChange={set("kind")}>
                {Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
              </select>
            </div>
          )}
          <div className="field">
            <label htmlFor="kb-title">{t("Title")}</label>
            <input id="kb-title" value={f.title} onChange={set("title")} required maxLength={200} placeholder={note ? t("for example: Starwheel jams after a size change") : ""} />
          </div>
          <div className="field">
            <label htmlFor="kb-machine">{t("Machine type")}</label>
            <input id="kb-machine" list="kb-machines" value={f.machine_type} onChange={set("machine_type")} maxLength={60} />
            <datalist id="kb-machines">{MACHINE_TYPES.map((m) => <option key={m} value={m} />)}</datalist>
          </div>
          <div className="field">
            <label htmlFor="kb-serial">{t("Machine number")}</label>
            <input id="kb-serial" className="mono" value={f.serial} onChange={set("serial")} maxLength={12} placeholder="3979MB" />
            <small className="muted">{t("Staff only. Never shown to customers.")}</small>
          </div>
          <div className="field">
            <label htmlFor="kb-cat">{t("Category")}</label>
            <select id="kb-cat" value={f.category} onChange={set("category")}>
              <option value="">{t("Choose for me")}</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{t(c)}</option>)}
            </select>
          </div>
          {can(me, "kb.publish") && (
            <fieldset className="field kb-aud">
              <legend>{t("Who sees it")}</legend>
              {Object.entries(AUDIENCE).map(([k, v]) => (
                <label key={k}><input type="radio" name="kb-aud" value={k} checked={f.audience === k} onChange={set("audience")} /> {t(v)}</label>
              ))}
            </fieldset>
          )}
        </div>
        {!note && (
          <div className="field">
            <label htmlFor="kb-sum">{t("Summary")}</label>
            <input id="kb-sum" value={f.summary} onChange={set("summary")} maxLength={600} />
          </div>
        )}
        <div className="grid g2">
          <div className="field">
            <label htmlFor="kb-issue">{t("Issue")}</label>
            <textarea id="kb-issue" value={f.issue} onChange={set("issue")} maxLength={8000} placeholder={t("What you saw: alarms, symptoms, when it happens")} />
          </div>
          <div className="field">
            <label htmlFor="kb-fix">{t("Fix")}</label>
            <textarea id="kb-fix" value={f.fix} onChange={set("fix")} maxLength={8000} placeholder={t("What fixed it, step by step")} />
          </div>
        </div>
        {details !== null && !note && (
          <div className="field">
            <label htmlFor="kb-body">{t("Details")}</label>
            <textarea id="kb-body" value={f.body} onChange={set("body")} maxLength={20000} rows={8} />
          </div>
        )}
        {details === null && <Tip id="kb.imported" className="muted small-note">{t("The steps and tables come from the document. To change them, import the document again.")}</Tip>}
        <ErrorNote error={err} />
        <div className="row">
          <button className="btn primary" type="submit">{article ? t("Save") : note ? t("Save quick note") : t("Save article")}</button>
          <button className="btn" type="button" onClick={() => (onDone ? onDone() : navigate("/kb"))}>{t("Cancel")}</button>
        </div>
      </form>
    </>
  );
}
