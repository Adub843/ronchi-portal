// Ronchi Parts: the catalog customers sign in to. They see only their own machines.
//
//   /                 my machines and favorites
//   /m/<serial>       one machine: its drawings, and suggested spares
//   /s/<sheet id>     one drawing or 3D assembly with its parts list
//   /p/<part code>    one part: where it's used on my machines
//   /search?q=        find a part on any of my machines
//   /cart             my carts; send one to Ronchi America as a quote request
//   /lists            parts lists shared in my company
//   /quotes           quote requests my company has sent
//   /account          add a device, language, sign out
//   /welcome#<token>  sign up from the link Ronchi America sent
import { useEffect, useState, type ReactNode } from "react";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import logoUrl from "./logo.png";
import { api, type Me } from "./api";
import { fmtTime, getLang, LANGS, setLang, t, useLang } from "./i18n";
import { Link, navigate, usePath } from "./router";
import { CatalogTree, type TreeSheet } from "../../web/catalog/CatalogTree";
import { SheetView } from "../../web/catalog/SheetView";
import type { Row } from "../../web/catalog/PartsList";
import { partName } from "../../web/catalog/words";

const enc = encodeURIComponent;

// ---------- small shared pieces ----------

function useLoad<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setError(null);
    load().then((d) => live && setData(d), (e: Error) => live && setError(e.message));
    return () => void (live = false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, error, reload: () => setTick((n) => n + 1) };
}

let toastTimer: number | undefined;
export function toast(message: string) {
  let el = document.querySelector<HTMLDivElement>(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    el.setAttribute("role", "status");
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el && (el.hidden = true), 3500);
}

const Err = ({ error }: { error: string | null }) => (error ? <p className="err" role="alert">{t(error)}</p> : null);
const Head = ({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) => (
  <div className="row pagehead"><div><h1>{title}</h1>{sub && <p className="sub">{sub}</p>}</div><span className="spacer" />{children}</div>
);

const cartListeners = new Set<() => void>();
const cartChanged = () => cartListeners.forEach((f) => f());

async function addToCart(code: string, serial: string | null, qty = 1) {
  try {
    await api("/carts/active/lines", { body: { code, serial, qty } });
    toast(t("Added to cart"));
    cartChanged();
  } catch (e) {
    toast(t((e as Error).message));
  }
}

// ---------- the app ----------

export function App() {
  const path = usePath();
  const lang = useLang();
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [cartCount, setCartCount] = useState(0);
  const refresh = () => api<{ user: Me | null }>("/auth/me").then((r) => setMe(r.user), () => setMe(null));
  useEffect(() => void refresh(), []);
  useEffect(() => {
    if (!me) return;
    const load = () => api("/carts/active").then((r) => setCartCount(r.lines.length), () => undefined);
    load();
    cartListeners.add(load);
    return () => void cartListeners.delete(load);
  }, [me]);

  const route = path.split("?")[0]!;
  if (route === "/welcome") return <Welcome onDone={refresh} />;
  if (me === undefined) return <div className="boot" aria-busy="true" />;
  if (me === null) return <SignIn onDone={refresh} />;

  const m = /^\/(m|s|p|lists|quotes)\/([A-Za-z0-9_-]+)$/.exec(route);
  let page: ReactNode;
  if (m?.[1] === "m") page = <Machine key={m[2]} serial={m[2]!} />;
  else if (m?.[1] === "s") page = <Sheet key={m[2]} id={m[2]!} />;
  else if (m?.[1] === "p") page = <Part key={m[2]} code={m[2]!} />;
  else if (m?.[1] === "lists") page = <List key={m[2]} id={m[2]!} />;
  else if (m?.[1] === "quotes") page = <Quote key={m[2]} id={m[2]!} />;
  else if (route === "/search") page = <Search key={path} q={new URLSearchParams(path.split("?")[1] ?? "").get("q") ?? ""} />;
  else if (route === "/cart") page = <Cart me={me} />;
  else if (route === "/lists") page = <Lists />;
  else if (route === "/quotes") page = <Quotes />;
  else if (route === "/account") page = <Account me={me} onSignOut={refresh} />;
  else page = <Home />;

  const section = "/" + (route.split("/")[1] ?? "");
  const nav = [
    { to: "/", label: t("My machines"), on: section === "/" || section === "/m" || section === "/s" },
    { to: "/search", label: t("Search"), on: section === "/search" || section === "/p" },
    { to: "/cart", label: cartCount ? t("Cart ({n})", { n: cartCount }) : t("Cart"), on: section === "/cart" },
    { to: "/lists", label: t("Lists"), on: section === "/lists" },
    { to: "/quotes", label: t("Quotes"), on: section === "/quotes" },
  ];

  return (
    <>
      <header className="top">
        <div className="wrap">
          <Link to="/" className="brand">
            <img src={logoUrl} alt="Ronchi" />
            <span>Ronchi Parts<small>{me.company}</small></span>
          </Link>
          <span className="spacer" />
          <form className="pp-search" role="search" onSubmit={(e) => {
            e.preventDefault();
            const q = new FormData(e.currentTarget).get("q");
            if (typeof q === "string" && q.trim()) navigate(`/search?q=${enc(q.trim())}`);
          }}>
            <input name="q" type="search" placeholder={t("Part number or name")} aria-label={t("Search parts")} />
          </form>
          <Link to="/account" className="who">{me.name}</Link>
        </div>
      </header>
      <div className="wrap" key={lang}>
        <div className="shell">
          <nav className="side" aria-label={t("Main")}>
            {nav.map((n) => <Link key={n.to} to={n.to} current={n.on}>{n.label}</Link>)}
          </nav>
          <main>{page}</main>
        </div>
      </div>
    </>
  );
}

// ---------- signing in ----------

function SignIn({ onDone }: { onDone: () => void }) {
  const lang = useLang();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function signIn() {
    setBusy(true);
    setError(null);
    try {
      const { challengeId, options } = await api("/auth/login/options", { body: {} });
      const response = await startAuthentication({ optionsJSON: options });
      await api("/auth/login/verify", { body: { challengeId, response } });
      onDone();
    } catch (e) {
      const err = e as Error;
      setError(err.name === "NotAllowedError" ? t("Sign-in was cancelled.") : err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="center">
      <div className="panel signin">
        <img src={logoUrl} alt="Ronchi" />
        <div>
          <h1>Ronchi Parts</h1>
          <p className="sub">{t("Spare parts catalog for your Ronchi machines. Sign in with Face ID, your fingerprint, Windows Hello or your device PIN.")}</p>
        </div>
        <button className="btn primary" onClick={signIn} disabled={busy}>{busy ? t("Waiting for your passkey…") : t("Sign in with passkey")}</button>
        <Err error={error} />
        <p className="muted">{t("No login yet, or on a new phone? Ask Ronchi America for a sign-up link.")}</p>
        <div className="row" role="radiogroup" aria-label={t("Language")}>
          {LANGS.map((l) => <button key={l.id} type="button" className="linkish" role="radio" aria-checked={lang === l.id} onClick={() => setLang(l.id)}>{l.name}</button>)}
        </div>
      </div>
    </div>
  );
}

function Welcome({ onDone }: { onDone: () => void }) {
  const [token] = useState(() => location.hash.slice(1));
  const [invite, setInvite] = useState<{ name: string; email: string; addingDevice: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    // Take the token out of the address bar straight away.
    history.replaceState(null, "", "/welcome");
    if (!token) return setError(t("This sign-up link isn't complete. Open it again from the message you were sent."));
    api("/auth/invite/check", { body: { token } }).then(setInvite, (e: Error) => setError(e.message));
  }, [token]);
  async function create() {
    setBusy(true);
    setError(null);
    try {
      const { challengeId, userId, options } = await api("/auth/register/options", { body: { token } });
      const response = await startRegistration({ optionsJSON: options });
      await api("/auth/register/verify", { body: { token, challengeId, userId, response } });
      navigate("/");
      onDone();
    } catch (e) {
      const err = e as Error;
      setError(err.name === "NotAllowedError" ? t("Passkey creation was cancelled. Try again.") : err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="center">
      <div className="panel signin">
        <img src={logoUrl} alt="Ronchi" />
        {invite ? (
          <>
            <div>
              <h1>{invite.addingDevice ? t("Add this device") : t("Welcome, {name}", { name: invite.name.split(" ")[0]! })}</h1>
              <p className="sub">{invite.addingDevice
                ? t("Create a passkey on this phone or computer so you can sign in here too.")
                : t("Your Ronchi Parts login is {email}. Create a passkey to finish: you'll sign in with Face ID, your fingerprint or your device PIN. No password.", { email: invite.email })}</p>
            </div>
            <button className="btn primary" onClick={create} disabled={busy}>{busy ? t("Follow the prompt on your device…") : t("Create my passkey")}</button>
          </>
        ) : !error && <p className="muted">{t("Checking your link…")}</p>}
        <Err error={error} />
      </div>
    </div>
  );
}

// ---------- machines ----------

function Home() {
  const { data, error } = useLoad(() => Promise.all([api("/machines"), api("/favorites")]));
  const favs = data?.[1].favorites ?? [];
  return (
    <>
      <Head title={t("My machines")} sub={t("Open a machine to see its drawings, 3D models and parts.")} />
      <Err error={error} />
      {data && !data[0].machines.length && <p className="empty">{t("No machines on your account yet. Ronchi America adds them for you.")}</p>}
      <div className="tiles">
        {data?.[0].machines.map((m: any) => (
          <Link key={m.serial} to={`/m/${m.serial}`} className="panel tile">
            <h2 className="mono">{m.serial}</h2>
            <span>{[m.model, m.label].filter(Boolean).join(" · ") || " "}</span>
            <span className="muted">{m.sheets ? t("{n} drawings", { n: m.sheets }) : t("Catalog coming soon")}{m.models ? ` · ${t("{n} in 3D", { n: m.models })}` : ""}</span>
          </Link>
        ))}
      </div>
      {favs.length > 0 && (
        <div className="panel">
          <h2>{t("Favorites")}</h2>
          {favs.map((f: any) => (
            <p key={`${f.kind}-${f.ref}`}>
              <Link to={f.kind === "machine" ? `/m/${f.ref}` : `/s/${f.ref}`}>{f.label || f.name}</Link> <span className="muted mono">{f.serial}</span>
            </p>
          ))}
        </div>
      )}
    </>
  );
}

function Star({ kind, refId, on, onChange }: { kind: "machine" | "sheet"; refId: string; on: boolean; onChange: () => void }) {
  return (
    <button className="btn" aria-pressed={on} onClick={async () => {
      try {
        await api(`/favorites/${kind}/${enc(refId)}`, { method: on ? "DELETE" : "PUT", body: on ? undefined : {} });
        onChange();
      } catch (e) {
        toast(t((e as Error).message));
      }
    }}>{on ? `★ ${t("Favorite")}` : `☆ ${t("Add to favorites")}`}</button>
  );
}

function useFavorites() {
  const f = useLoad(() => api("/favorites"));
  const has = (kind: string, ref: string) => !!f.data?.favorites.some((x: any) => x.kind === kind && x.ref === ref);
  return { has, reload: f.reload };
}

function Machine({ serial }: { serial: string }) {
  const { data, error } = useLoad(() => api(`/machines/${enc(serial)}`), [serial]);
  const [tab, setTab] = useState<"drawings" | "spares">("drawings");
  const spares = useLoad(() => (tab === "spares" ? api(`/machines/${enc(serial)}/spares`) : Promise.resolve(null)), [tab, serial]);
  const fav = useFavorites();
  if (error) return <Err error={error} />;
  if (!data) return null;
  const m = data.machine;
  return (
    <>
      <Head title={m.serial} sub={[m.model, m.label].filter(Boolean).join(" · ") || undefined}>
        <Star kind="machine" refId={m.serial} on={fav.has("machine", m.serial)} onChange={fav.reload} />
      </Head>
      <div className="cv-tabs" role="tablist">
        <button role="tab" aria-selected={tab === "drawings"} onClick={() => setTab("drawings")}>{t("Drawings")}</button>
        <button role="tab" aria-selected={tab === "spares"} onClick={() => setTab("spares")}>{t("Suggested spares")}</button>
      </div>
      {tab === "drawings" && (
        <div className="panel">
          {!data.sheets.length ? <p className="empty">{t("This machine's catalog isn't ready yet. Ronchi America is preparing it.")}</p> : (
            <CatalogTree sheets={data.sheets as TreeSheet[]} lang={getLang()} link={(s) => <Link to={`/s/${s.id}`}>{s.title}</Link>} />
          )}
        </div>
      )}
      {tab === "spares" && (
        <div className="panel tbl stack">
          <p className="muted">{t("Parts on this machine that wear out. Keeping these on the shelf saves a stop.")}</p>
          {spares.data && !spares.data.spares.length && <p className="empty">{t("No wear parts marked for this machine yet.")}</p>}
          {!!spares.data?.spares.length && (
            <table>
              <thead><tr><th>{t("Part number")}</th><th>{t("Description")}</th><th>{t("Used on machine")}</th><th /></tr></thead>
              <tbody>
                {spares.data.spares.map((p: any) => (
                  <tr key={p.code}>
                    <td className="mono"><Link to={`/p/${p.code}`}>{p.code}</Link></td>
                    <td><Link to={`/s/${p.sheet_id}`}>{partName(getLang(), p)}</Link></td>
                    <td>{p.qty}{p.unit === "m" ? " m" : ""}</td>
                    <td><button className="btn small" onClick={() => addToCart(p.code, serial, p.qty || 1)}>{t("Add to cart")}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </>
  );
}

function Sheet({ id }: { id: string }) {
  const { data, error } = useLoad(() => api(`/sheets/${enc(id)}`), [id]);
  const fav = useFavorites();
  if (error) return <Err error={error} />;
  if (!data) return null;
  const s = data.sheet;
  const rows: Row[] = data.rows;
  return (
    <>
      <nav className="crumbs" aria-label={t("Where this drawing sits")}>
        <Link to={`/m/${s.serial}`}>{s.serial}</Link>
        {s.path.map((p: any) => <span key={p.id}> › <Link to={`/s/${p.id}`}>{p.title}</Link></span>)}
      </nav>
      <Head title={s.title} sub={s.code ?? undefined}>
        <Star kind="sheet" refId={s.id} on={fav.has("sheet", s.id)} onChange={fav.reload} />
      </Head>
      <SheetView
        sheet={s}
        rows={rows}
        lang={getLang()}
        fileUrl={(kind) => `/api/sheets/${enc(id)}/${kind}`}
        onOpenSheet={(sid) => navigate(`/s/${sid}`)}
        partLink={(code) => <Link to={`/p/${code}`}>{code}</Link>}
        action={(r) => <button type="button" className="btn small" onClick={() => addToCart(r.code, s.serial, r.qty && r.unit !== "m" ? r.qty : 1)}>{t("Add to cart")}</button>}
      />
    </>
  );
}

function Part({ code }: { code: string }) {
  const { data, error } = useLoad(() => api(`/parts/${enc(code)}`), [code]);
  if (error) return <Err error={error} />;
  if (!data) return null;
  const p = data.part;
  return (
    <>
      <Head title={p.code} sub={partName(getLang(), p) || undefined}>
        <button className="btn primary" onClick={() => addToCart(p.code, data.usedOn.length === 1 ? data.usedOn[0].serial : null)}>{t("Add to cart")}</button>
      </Head>
      {(p.maker || p.wear) && (
        <p>{p.maker && <>{t("Made by {maker}", { maker: p.maker })} {p.maker_pn && <span className="mono">{p.maker_pn}</span>}</>} {!!p.wear && <span className="cv-tag">{t("Wear part")}</span>}</p>
      )}
      <div className="panel tbl">
        <h2>{t("Where it's used on your machines")}</h2>
        <table>
          <thead><tr><th>{t("Machine")}</th><th>{t("Drawing")}</th><th>{t("Pos.")}</th><th>{t("Qty")}</th></tr></thead>
          <tbody>
            {data.usedOn.map((u: any, i: number) => (
              <tr key={i}><td className="mono"><Link to={`/m/${u.serial}`}>{u.serial}</Link></td><td><Link to={`/s/${u.sheet_id}`}>{u.sheet_title}</Link></td><td>{u.pos}</td><td>{u.qty ?? "–"}{u.unit === "m" ? " m" : ""}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Search({ q }: { q: string }) {
  const [text, setText] = useState(q);
  const { data, error } = useLoad(() => (q.length >= 2 ? api(`/search?q=${enc(q)}`) : Promise.resolve({ results: [] })), [q]);
  return (
    <>
      <Head title={t("Search")} sub={t("Find a part on any of your machines by its number, name, or the maker's part number.")} />
      <form className="row" onSubmit={(e) => { e.preventDefault(); navigate(`/search?q=${enc(text.trim())}`); }}>
        <input className="panel" style={{ flex: 1, padding: "10px 12px", font: "inherit" }} value={text} onChange={(e) => setText(e.target.value)} placeholder={t("Part number or name")} aria-label={t("Search parts")} />
        <button className="btn" type="submit">{t("Search")}</button>
      </form>
      <Err error={error} />
      {q && data && !data.results.length && <p className="empty">{t("Nothing found on your machines for \"{q}\".", { q })}</p>}
      {!!data?.results.length && (
        <div className="panel tbl">
          <table>
            <thead><tr><th>{t("Part number")}</th><th>{t("Description")}</th><th>{t("Machine")}</th><th>{t("Drawing")}</th><th /></tr></thead>
            <tbody>
              {data.results.map((r: any, i: number) => (
                <tr key={i}>
                  <td className="mono"><Link to={`/p/${r.code}`}>{r.code}</Link></td>
                  <td>{partName(getLang(), r)}</td>
                  <td className="mono">{r.serial}</td>
                  <td><Link to={`/s/${r.sheet_id}`}>{r.sheet_title}</Link> <span className="muted">· {t("Pos.")} {r.pos}</span></td>
                  <td><button className="btn small" onClick={() => addToCart(r.code, r.serial)}>{t("Add to cart")}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ---------- carts, lists, quotes ----------

function Lines({ lines, onChange, editable, machines }: { lines: any[]; onChange: () => void; editable: boolean; machines?: string[] }) {
  const patch = async (id: string, body: object) => {
    try {
      await api(`/lines/${enc(id)}`, { method: "PATCH", body });
      onChange();
    } catch (e) {
      toast(t((e as Error).message));
    }
  };
  if (!lines.length) return <p className="empty">{t("Nothing here yet. Open a drawing and use Add to cart.")}</p>;
  return (
    <div className="tbl">
      <table>
        <thead><tr><th>{t("Part number")}</th><th>{t("Description")}</th><th>{t("Machine")}</th><th>{t("Qty")}</th><th>{t("Note")}</th>{editable && <th />}</tr></thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id}>
              <td className="mono">{l.code ? <Link to={`/p/${l.code}`}>{l.code}</Link> : "–"}</td>
              <td>{l.code ? partName(getLang(), l) : l.description}</td>
              <td className="mono">
                {editable && machines ? (
                  <select value={l.serial ?? ""} aria-label={t("Machine")} onChange={(e) => patch(l.id, { serial: e.target.value || null })}>
                    <option value="">–</option>{machines.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                ) : (l.serial ?? "–")}
              </td>
              <td>{editable ? <input className="pp-qty" type="number" min={0.001} step="any" defaultValue={l.qty} aria-label={t("Qty")} onBlur={(e) => Number(e.target.value) !== l.qty && patch(l.id, { qty: Number(e.target.value) })} /> : l.qty}</td>
              <td>{editable ? <input defaultValue={l.note} aria-label={t("Note")} onBlur={(e) => e.target.value !== l.note && patch(l.id, { note: e.target.value })} /> : l.note}</td>
              {editable && <td><button className="btn small danger" onClick={async () => { await api(`/lines/${enc(l.id)}`, { method: "DELETE" }).catch(() => undefined); onChange(); cartChanged(); }}>{t("Remove")}</button></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AddByHand({ path, onDone }: { path: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ description: "", qty: "1" });
  if (!open) return <button className="btn" onClick={() => setOpen(true)}>{t("Add a part that isn't in the catalog")}</button>;
  return (
    <form className="row" onSubmit={async (e) => {
      e.preventDefault();
      try {
        await api(path, { body: { description: f.description, qty: Number(f.qty) } });
        setF({ description: "", qty: "1" });
        setOpen(false);
        onDone();
        cartChanged();
      } catch (x) {
        toast(t((x as Error).message));
      }
    }}>
      <input style={{ flex: 1 }} required value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder={t("Describe it: maker, model, size")} aria-label={t("Description")} />
      <input className="pp-qty" type="number" min={1} value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} aria-label={t("Qty")} />
      <button className="btn primary" type="submit">{t("Add")}</button>
    </form>
  );
}

function Cart({ me }: { me: Me }) {
  const carts = useLoad(() => api("/carts"));
  const active = useLoad(() => api("/carts/active"));
  const machines = useLoad(() => api("/machines"));
  const [email, setEmail] = useState(me.email);
  const [sending, setSending] = useState(false);
  const reload = () => { carts.reload(); active.reload(); cartChanged(); };
  const cart = active.data?.cart;
  const lines = active.data?.lines ?? [];
  const serials = (machines.data?.machines ?? []).map((m: any) => m.serial);

  return (
    <>
      <Head title={cart ? cart.name : t("Cart")} sub={t("Collect parts here, then send them to Ronchi America for a quote.")}>
        <button className="btn" onClick={async () => { await api("/carts", { body: {} }); reload(); }}>{t("New cart")}</button>
      </Head>
      {(carts.data?.carts.length ?? 0) > 1 && (
        <div className="row" style={{ flexWrap: "wrap" }}>
          <span className="muted">{t("Your carts:")}</span>
          {carts.data!.carts.map((c: any) => (
            <button key={c.id} className="btn small" aria-pressed={!!c.active} onClick={async () => { await api(`/carts/${enc(c.id)}`, { method: "PATCH", body: { active: true } }); reload(); }}>
              {c.name} ({c.items})
            </button>
          ))}
        </div>
      )}
      <div className="panel stack">
        <Lines lines={lines} onChange={reload} editable machines={serials} />
        {cart && <AddByHand path={`/carts/${enc(cart.id)}/lines`} onDone={reload} />}
        {cart && (
          <div className="field">
            <label htmlFor="cart-notes">{t("Notes for Ronchi America")}</label>
            <textarea id="cart-notes" defaultValue={cart.notes} onBlur={(e) => api(`/carts/${enc(cart.id)}`, { method: "PATCH", body: { notes: e.target.value } }).catch(() => undefined)} placeholder={t("Line down? Shipping instructions? Anything we should know.")} />
          </div>
        )}
      </div>
      {cart && lines.length > 0 && (
        <div className="panel stack">
          <div className="row" style={{ flexWrap: "wrap" }}>
            <a className="btn" href={`/api/carts/${enc(cart.id)}/csv`} download>{t("Download for Excel")}</a>
            <button className="btn" onClick={async () => {
              const name = prompt(t("Name for the shared list"), cart.name);
              if (!name) return;
              try {
                const r = await api("/lists", { body: { name, fromCart: cart.id } });
                navigate(`/lists/${r.id}`);
              } catch (e) {
                toast(t((e as Error).message));
              }
            }}>{t("Save as a shared list")}</button>
            <button className="btn danger" onClick={async () => {
              if (!confirm(t("Delete this cart?"))) return;
              await api(`/carts/${enc(cart.id)}`, { method: "DELETE" }).catch(() => undefined);
              reload();
            }}>{t("Delete cart")}</button>
          </div>
          {me.role === "buyer" ? (
            <form className="stack" onSubmit={async (e) => {
              e.preventDefault();
              setSending(true);
              try {
                const r = await api(`/carts/${enc(cart.id)}/quote`, { body: { email } });
                toast(t("Sent. Your request number is {n}.", { n: r.number }));
                navigate(`/quotes/${r.id}`);
              } catch (x) {
                toast(t((x as Error).message));
              } finally {
                setSending(false);
              }
            }}>
              <h2>{t("Ask Ronchi America for a quote")}</h2>
              <div className="field"><label htmlFor="q-email">{t("Send the quote to")}</label><input id="q-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
              <div><button className="btn primary" type="submit" disabled={sending}>{t("Send quote request")}</button></div>
            </form>
          ) : (
            <p className="muted">{t("Only your company's buyers can send quote requests. Save the cart as a shared list so a buyer can send it.")}</p>
          )}
        </div>
      )}
    </>
  );
}

function Lists() {
  const { data, error } = useLoad(() => api("/lists"));
  return (
    <>
      <Head title={t("Shared lists")} sub={t("Parts lists everyone at your company can see, like a shutdown kit or a spares order.")} />
      <Err error={error} />
      <div className="panel tbl">
        {data && !data.lists.length && <p className="empty">{t("No shared lists yet. Save a cart as a list to share it.")}</p>}
        {!!data?.lists.length && (
          <table>
            <thead><tr><th>{t("List")}</th><th>{t("Items")}</th><th>{t("Made by")}</th><th>{t("Changed")}</th></tr></thead>
            <tbody>{data.lists.map((l: any) => <tr key={l.id}><td><Link to={`/lists/${l.id}`}>{l.name}</Link></td><td>{l.items}</td><td>{l.made_by}</td><td>{fmtTime(l.updated_at)}</td></tr>)}</tbody>
          </table>
        )}
      </div>
    </>
  );
}

function List({ id }: { id: string }) {
  const { data, error, reload } = useLoad(() => api(`/lists/${enc(id)}`), [id]);
  if (error) return <Err error={error} />;
  if (!data) return null;
  return (
    <>
      <Head title={data.list.name}>
        <button className="btn primary" onClick={async () => { await api(`/lists/${enc(id)}/to-cart`, { body: {} }); cartChanged(); toast(t("Copied to your cart")); }}>{t("Copy to my cart")}</button>
        <a className="btn" href={`/api/lists/${enc(id)}/csv`} download>{t("Download for Excel")}</a>
        <button className="btn danger" onClick={async () => { if (!confirm(t("Delete this list for everyone at your company?"))) return; await api(`/lists/${enc(id)}`, { method: "DELETE" }); navigate("/lists"); }}>{t("Delete list")}</button>
      </Head>
      <div className="panel stack">
        <Lines lines={data.lines} onChange={reload} editable />
        <AddByHand path={`/lists/${enc(id)}/lines`} onDone={reload} />
      </div>
    </>
  );
}

const STATUS: Record<string, string> = { sent: "Sent", received: "Received by Ronchi America", quoted: "Quote sent to you", closed: "Closed" };

function Quotes() {
  const { data, error } = useLoad(() => api("/quotes"));
  return (
    <>
      <Head title={t("Quote requests")} sub={t("Every request your company has sent, and where it stands.")} />
      <Err error={error} />
      <div className="panel tbl">
        {data && !data.quotes.length && <p className="empty">{t("No quote requests yet.")}</p>}
        {!!data?.quotes.length && (
          <table>
            <thead><tr><th>{t("Request")}</th><th>{t("Items")}</th><th>{t("Sent by")}</th><th>{t("Sent")}</th><th>{t("Status")}</th></tr></thead>
            <tbody>{data.quotes.map((q: any) => <tr key={q.id}><td className="mono"><Link to={`/quotes/${q.id}`}>{q.number}</Link></td><td>{q.items}</td><td>{q.sent_by}</td><td>{fmtTime(q.created_at)}</td><td>{t(STATUS[q.status] ?? q.status)}</td></tr>)}</tbody>
          </table>
        )}
      </div>
    </>
  );
}

function Quote({ id }: { id: string }) {
  const { data, error } = useLoad(() => api(`/quotes/${enc(id)}`), [id]);
  if (error) return <Err error={error} />;
  if (!data) return null;
  const q = data.quote;
  return (
    <>
      <Head title={q.number} sub={`${t(STATUS[q.status] ?? q.status)} · ${fmtTime(q.created_at)}`}>
        <button className="btn" onClick={async () => { const r = await api("/lists", { body: { name: q.number, fromQuote: q.id } }); navigate(`/lists/${r.id}`); }}>{t("Save as a shared list")}</button>
      </Head>
      {q.notes && <div className="panel"><p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{q.notes}</p></div>}
      <div className="panel"><Lines lines={data.lines} onChange={() => undefined} editable={false} /></div>
    </>
  );
}

// ---------- account ----------

function Account({ me, onSignOut }: { me: Me; onSignOut: () => void }) {
  const lang = useLang();
  const [link, setLink] = useState<string | null>(null);
  return (
    <>
      <Head title={me.name} sub={`${me.email} · ${me.company}`} />
      <div className="panel stack">
        <h2>{t("Language")}</h2>
        <div className="row">{LANGS.map((l) => <button key={l.id} className="btn" aria-pressed={lang === l.id} onClick={() => setLang(l.id)}>{l.name}</button>)}</div>
      </div>
      <div className="panel stack">
        <h2>{t("Sign in on another device")}</h2>
        <p className="muted">{t("Make a one-time link, open it on your other phone or computer within an hour, and create a passkey there.")}</p>
        <div><button className="btn" onClick={async () => { const r = await api("/auth/add-device", { body: {} }); setLink(r.link); }}>{t("Make a link")}</button></div>
        {link && <div className="row"><input readOnly value={link} style={{ flex: 1 }} onFocus={(e) => e.target.select()} aria-label={t("Link")} /><button className="btn" onClick={() => navigator.clipboard.writeText(link).then(() => toast(t("Copied")))}>{t("Copy")}</button></div>}
      </div>
      <div className="panel stack">
        <p className="muted">{me.role === "buyer" ? t("You can send quote requests for your company.") : t("A buyer at your company sends quote requests. Ask Ronchi America if you need to send them too.")}</p>
        <div><button className="btn danger" onClick={async () => { await api("/auth/logout", { body: {} }); navigate("/"); onSignOut(); }}>{t("Sign out")}</button></div>
      </div>
    </>
  );
}
