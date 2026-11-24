// The help center's pages, written as plain HTML strings.
// Everything that came from the database goes through esc() so it shows as text, never as code.

export interface ArticleRow {
  number: string; kind: string; title: string; machine_type: string | null; category: string | null; issue: string; fix: string;
}

export function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
}

// Customers who search by their company name or machine number are sent to their own parts account,
// which knows the machines on their account. The help center itself never knows who owns what.
export const PARTS_SITE = "https://ronchi-parts.business-console.workers.dev/";
const MACHINE_NUMBER = /^\s*(\d{4}[A-Z]{1,3}|RA-?\d{4}[A-Z]{0,2})\s*$/i;

const KIND_LABEL: Record<string, string> = { opl: "One Point Lesson", howto: "How-to", issue_fix: "Issue and fix", training: "Training" };

const STYLE = `
:root{--bg:#eceef1;--solid:#fff;--ink:#15181c;--muted:#5a616b;--line:#d8dce2;--steel:#15181c;--steel-ink:#eceef1;--accent:#e30613;--info:#1f5f99;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#111316;--solid:#1a1d22;--ink:#eceef1;--muted:#9aa2ac;--line:#2c3138;--steel:#0b0c0e;--accent:#f0313b;--info:#7ab6ef}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 "Work Sans",system-ui,-apple-system,"Segoe UI",Arial,sans-serif}
header{background:var(--solid);border-bottom:1px solid var(--line)}
.wrap{max-width:960px;margin:0 auto;padding:0 16px}
header .wrap{display:flex;align-items:center;gap:12px;padding-block:12px}
header img{height:26px;width:auto}header span{font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--muted)}
.hero{background:var(--steel);color:var(--steel-ink);border-radius:12px;padding:22px;margin:18px 0}
.hero h1{margin:0 0 4px;font-size:clamp(24px,4vw,32px);line-height:1.1}
.hero p{margin:0;opacity:.8}.hero p.sub{margin-top:6px;font-size:13px}.hero a{color:inherit}
.hint p{margin:12px 0}
form{display:flex;gap:8px;margin-top:14px;flex-wrap:wrap}
input[type=search]{flex:1;min-width:0;font:16px inherit;font-family:inherit;padding:12px 14px;border:0;border-radius:4px}
button{font:600 15px inherit;font-family:inherit;padding:12px 18px;border:0;border-radius:4px;background:var(--accent);color:#fff;cursor:pointer}
.panel{background:var(--solid);border:1px solid var(--line);border-radius:12px;padding:6px 18px;margin-bottom:24px}
.r{padding:14px 0;border-bottom:1px solid var(--line)}.r:last-child{border-bottom:0}
.r a{font-weight:600;color:var(--info);text-decoration:none;font-size:16px}.r a:hover{text-decoration:underline}
.meta{font-size:12px;color:var(--muted);display:flex;gap:8px;flex-wrap:wrap;margin-top:2px}
.pill{font-size:11px;font-weight:600;padding:1px 8px;border-radius:99px;background:var(--bg)}
.snip{color:var(--muted);margin:4px 0 0;font-size:14px}
article h1{font-size:28px;line-height:1.15;margin:18px 0 6px}article h2{font-size:17px;margin:20px 0 6px}
article p,article li{white-space:pre-wrap}
footer{color:var(--muted);font-size:12px;padding:16px 0 32px}
a:focus-visible,input:focus-visible,button:focus-visible{outline:2px solid var(--info);outline-offset:2px}
`;

function shell(title: string, inner: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="Ronchi America help center: One Point Lessons, how-tos and fixes for Ronchi machines.">
<style>${STYLE}</style></head><body>
<header><div class="wrap"><a href="/"><img src="/logo.png" alt="Ronchi"></a><span>Help center</span></div></header>
<main class="wrap">${inner}</main>
<footer class="wrap">Ronchi America help center. Articles are written by Ronchi.</footer></body></html>`;
}

export function page(q: string, results: string | null): string {
  const body = results ?? `<div class="panel"><p>Too many searches from your network. Wait a minute and try again.</p></div>`;
  return shell("Ronchi Help Center", `
<section class="hero"><h1>How can we help?</h1><p>Describe the problem or the fix. Search covers One Point Lessons, how-tos and known issues.</p>
<p class="sub">Searching by your company name or machine number? <a href="${PARTS_SITE}">Sign in to Ronchi Parts</a> to see your own machines.</p>
<form method="get" action="/" role="search"><input type="search" name="q" value="${esc(q)}" placeholder="for example: capper torque drifting" aria-label="Search the help center" maxlength="200"><button type="submit">Search</button></form></section>
${body}`);
}

function machineHint(q: string): string {
  return MACHINE_NUMBER.test(q)
    ? `<div class="panel hint"><p><strong>Looking for machine ${esc(q.trim().toUpperCase())}?</strong> Sign in to Ronchi Parts to see the manuals, parts and documents for the machines on your account. <a href="${PARTS_SITE}">Sign in to Ronchi Parts</a></p></div>`
    : "";
}

export function resultsHtml(q: string, rows: ArticleRow[]): string {
  const hint = machineHint(q);
  if (hint) return hint;
  if (!rows.length) {
    return `<div class="panel"><p>${q ? `Nothing matched “${esc(q)}”. Try fewer or different words.` : "Articles will appear here as Ronchi publishes them."}</p></div>`;
  }
  return `<div class="panel">${rows.map((r) => `<div class="r"><a href="/a/${esc(r.number)}">${esc(r.title)}</a>
<div class="meta"><span class="pill">${esc(KIND_LABEL[r.kind] ?? r.kind)}</span><span>${esc(r.number)}</span>${r.machine_type ? `<span>${esc(r.machine_type)}</span>` : ""}${r.category ? `<span>${esc(r.category)}</span>` : ""}</div>
${r.issue ? `<p class="snip">${esc(r.issue.slice(0, 200))}${r.issue.length > 200 ? "…" : ""}</p>` : ""}</div>`).join("")}</div>`;
}

export function articlePage(a: ArticleRow & { body: string; updated_at: string }): string {
  return shell(`${a.title} | Ronchi Help Center`, `<article class="panel">
<div class="meta" style="margin-top:14px"><span class="pill">${esc(KIND_LABEL[a.kind] ?? a.kind)}</span><span>${esc(a.number)}</span><span>Updated ${esc(a.updated_at.slice(0, 10))}</span></div>
<h1>${esc(a.title)}</h1>
${a.issue ? `<h2>Issue</h2><p>${esc(a.issue)}</p>` : ""}
${a.fix ? `<h2>Fix</h2><p>${esc(a.fix)}</p>` : ""}
${a.body ? `<h2>Details</h2><p>${esc(a.body)}</p>` : ""}
<p><a href="/">← Back to search</a></p></article>`);
}
