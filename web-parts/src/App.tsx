// Ronchi Parts: the catalog customers sign in to. They see only their own machines.
//
//   /                 my machines and favorites
//   /m/<serial>       one machine: its available content (catalogue, suggested spares, parts book)
//   /m/<serial>/catalog[/<section>[/<group>]]   the spare parts catalogue, one level of tiles at a time
//   /m/<serial>/spares  wear parts to keep on the shelf
//   /s/<sheet id>     one drawing or 3D assembly with its parts list
//   /book/<serial>    a parts book: chosen drawings with their parts lists, to print or save as PDF
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
import type { TreeSheet } from "../../web/catalog/CatalogTree";
import { CatalogBrowse, Crumbs, levelFrom, SECTION_WORD, Tile, TilePage } from "../../web/catalog/Browse";
import { IC, TILE } from "../../web/catalog/icons";
import { SheetView } from "../../web/catalog/SheetView";
import type { Row } from "../../web/catalog/PartsList";
import { partName, w, type Lang, type Word } from "../../web/catalog/words";

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

// The machine the person is looking at, for the "Select machine" bar. Pages set it.
let currentMachine: string | null = null;
const machineListeners = new Set<() => void>();
function useCurrentMachine(serial: string | null | undefined) {
  useEffect(() => {
    if (serial === undefined) return;
    currentMachine = serial;
    machineListeners.forEach((f) => f());
  }, [serial]);
}
function useShownMachine(): string | null {
  const [m, setM] = useState(currentMachine);
  useEffect(() => {
    const on = () => setM(currentMachine);
    machineListeners.add(on);
    return () => void machineListeners.delete(on);
  }, []);
  return m;
}

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

  const parts = route.split("/").filter(Boolean);
  const m = /^\/(s|p|lists|quotes|book)\/([A-Za-z0-9_-]+)$/.exec(route);
  let page: ReactNode;
  if (parts[0] === "m" && parts[1] && /^[A-Za-z0-9_-]+$/.test(parts[1])) {
    const serial = parts[1].toUpperCase();
    if (parts[2] === "catalog") page = <MachineCatalog key={route} serial={serial} rest={parts.slice(3)} />;
    else if (parts[2] === "spares") page = <Spares key={serial} serial={serial} />;
    else page = <Machine key={serial} serial={serial} />;
  } else if (m?.[1] === "s") page = <Sheet key={m[2]} id={m[2]!} />;
  else if (m?.[1] === "book") page = <Book key={m[2]} serial={m[2]!} />;
  else if (m?.[1] === "p") page = <Part key={m[2]} code={m[2]!} />;
  else if (m?.[1] === "lists") page = <List key={m[2]} id={m[2]!} />;
  else if (m?.[1] === "quotes") page = <Quote key={m[2]} id={m[2]!} />;
  else if (route === "/search") page = <Search key={path} q={new URLSearchParams(path.split("?")[1] ?? "").get("q") ?? ""} />;
  else if (route === "/cart") page = <Cart me={me} />;
  else if (route === "/lists") page = <Lists />;
  else if (route === "/quotes") page = <Quotes />;
  else if (route === "/account") page = <Account me={me} onSignOut={refresh} />;
  else page = <Home />;

  return (
    <>
      <TopBar me={me} cartCount={cartCount} route={route} lang={lang} />
      <div className="wrap" key={lang}>
        <main className="mv-main">{page}</main>
      </div>
    </>
  );
}

/** The header, laid out like the Ronchi Mario portal: brand, greeting, language, search and icons,
 *  then the "Select machine" bar with the machine-number box and the favorite star. */
function TopBar({ me, cartCount, route, lang }: { me: Me; cartCount: number; route: string; lang: Lang }) {
  const shown = useShownMachine();
  const serial = route.startsWith("/m/") || route.startsWith("/book/") || route.startsWith("/s/") ? shown : null;
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const machines = useLoad(() => api("/machines"));
  const fav = useFavorites();
  useEffect(() => { setOpen(false); setMenu(false); }, [route]);
  const list: any[] = machines.data?.machines ?? [];
  const go = (q: string) => {
    const v = q.trim().toUpperCase();
    if (!v) return;
    const hit = list.find((x) => x.serial.toUpperCase() === v) ?? (list.filter((x) => x.serial.toUpperCase().includes(v)).length === 1 ? list.find((x) => x.serial.toUpperCase().includes(v)) : null);
    navigate(hit ? `/m/${hit.serial}` : `/search?q=${enc(q.trim())}`);
  };
  return (
    <header className="mh">
      <div className="mh-top">
        <Link to="/" className="mh-brand"><img src={logoUrl} alt="Ronchi" /><span><b>Ronchi Parts</b><small>{me.company}</small></span></Link>
        <span className="mh-hello">{t("Hello {name}", { name: me.name })}</span>
        <label className="mh-lang">
          <span className="sr">{t("Language")}</span>
          <select value={lang} onChange={(e) => setLang(e.target.value as Lang)}>{LANGS.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
        </label>
        <span className="spacer" />
        <form className="mh-search" role="search" onSubmit={(e) => {
          e.preventDefault();
          const q = new FormData(e.currentTarget).get("q");
          if (typeof q === "string" && q.trim()) navigate(`/search?q=${enc(q.trim())}`);
        }}>
          <input name="q" type="search" placeholder={serial ? t("Search in {machine}", { machine: serial }) : t("Search in all my machines")} aria-label={t("Search parts")} />
          <button type="submit" aria-label={t("Search")}>{IC.search}</button>
        </form>
        <Link to="/" className="mh-ic" current={route === "/"}><span className="sr">{t("Home")}</span>{IC.home}</Link>
        <Link to="/lists" className="mh-ic" current={route.startsWith("/lists")}><span className="sr">{t("Lists")}</span>{IC.bookmarks}</Link>
        <Link to="/cart" className="mh-ic mh-cart" current={route === "/cart"}>
          <span className="sr">{t("Cart")}</span>{IC.cart}{cartCount > 0 && <span className="mh-count">{cartCount}</span>}
        </Link>
        <div className="mh-menu">
          <button type="button" className="mh-ic" aria-expanded={menu} aria-label={t("Menu")} onClick={() => setMenu(!menu)}>{IC.menu}</button>
          {menu && (
            <nav className="mh-drop" aria-label={t("Main")}>
              <Link to="/">{t("My machines")}</Link>
              <Link to="/search">{t("Search")}</Link>
              <Link to="/cart">{cartCount ? t("Cart ({n})", { n: cartCount }) : t("Cart")}</Link>
              <Link to="/lists">{t("Lists")}</Link>
              <Link to="/quotes">{t("Quotes")}</Link>
              <Link to="/account">{t("Account")}</Link>
            </nav>
          )}
        </div>
      </div>
      <div className="mh-bar">
        <button type="button" className="mh-pick" aria-expanded={open} onClick={() => setOpen(!open)}>
          {serial ?? t("Select machine")} {IC.caret}
        </button>
        <form className="mh-sn" onSubmit={(e) => { e.preventDefault(); go(String(new FormData(e.currentTarget).get("sn") ?? "")); }}>
          <input name="sn" list="mh-serials" placeholder={t("Machine number")} aria-label={t("Machine number")} />
          <datalist id="mh-serials">{list.map((x) => <option key={x.serial} value={x.serial}>{x.label ?? x.model ?? ""}</option>)}</datalist>
        </form>
        {serial && <Star kind="machine" refId={serial} on={fav.has("machine", serial)} onChange={fav.reload} />}
      </div>
      {open && (
        <div className="mh-panel">
          <MachinePicker machines={list} current={serial} onClose={() => setOpen(false)} />
        </div>
      )}
    </header>
  );
}

function MachinePicker({ machines, current, onClose }: { machines: any[]; current: string | null; onClose: () => void }) {
  const [q, setQ] = useState("");
  const s = q.trim().toLowerCase();
  const shown = machines.filter((m) => !s || [m.serial, m.model, m.label].some((v) => v && String(v).toLowerCase().includes(s)));
  return (
    <TilePage title={t("My machines")} lang={getLang()} filter={q} onFilter={setQ} tools={<button type="button" className="mv-ib" aria-label={t("Close")} onClick={onClose}>{IC.close}</button>}>
      {shown.map((m) => <Tile key={m.serial} to={`/m/${m.serial}`} L={Link} pic={TILE.filler} label={m.serial} sub={m.label ?? m.model ?? undefined} current={m.serial === current} />)}
      {!machines.length && <p className="mv-none">{t("No machines on your account yet. Ronchi America adds them for you.")}</p>}
    </TilePage>
  );
}

function QtyCart({ code, serial, qty }: { code: string; serial: string | null; qty: number }) {
  const [n, setN] = useState(String(qty));
  return (
    <span className="qc">
      <input inputMode="numeric" value={n} onChange={(e) => setN(e.target.value.replace(/[^0-9]/g, "").slice(0, 4))} aria-label={t("How many")} />
      <button type="button" title={t("Add to cart")} aria-label={t("Add {code} to cart", { code })} onClick={() => addToCart(code, serial, Math.max(1, Number(n) || 1))}>{IC.cart}</button>
    </span>
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
  useCurrentMachine(null);
  const { data, error } = useLoad(() => Promise.all([api("/machines"), api("/favorites")]));
  const machines: any[] = data?.[0].machines ?? [];
  const favs: any[] = data?.[1].favorites ?? [];
  const recent = machines.filter((m) => m.published_at).sort((a, b) => String(b.published_at).localeCompare(String(a.published_at))).slice(0, 5);
  const lang = getLang();
  return (
    <div className="mh-home">
      <div>
        <h2 className="mh-h">{t("Favorite machines")}</h2>
        {!favs.length && <p className="muted small">{t("No favorites yet. Open a machine or a parts list and press the star.")}</p>}
        {favs.length > 0 && (
          <div className="mv-tiles">
            {favs.map((f) => (
              <Tile key={`${f.kind}-${f.ref}`} to={f.kind === "machine" ? `/m/${f.ref}` : `/s/${f.ref}`} L={Link} pic={f.kind === "machine" ? TILE.filler : TILE.partsList} label={f.kind === "machine" ? f.ref : (f.label || f.name)} sub={f.kind === "machine" ? (f.label || undefined) : f.serial} />
            ))}
          </div>
        )}
        <h2 className="mh-h">{t("My machines")}</h2>
        <Err error={error} />
        {data && !machines.length && <p className="empty">{t("No machines on your account yet. Ronchi America adds them for you.")}</p>}
        <div className="mv-tiles">
          {machines.map((m) => (
            <Tile key={m.serial} to={`/m/${m.serial}`} L={Link} pic={TILE.filler} label={m.serial}
              sub={[m.label ?? m.model, m.sheets ? t("{n} parts lists", { n: m.sheets }) : t("Catalogue being prepared")].filter(Boolean).join(" · ")} />
          ))}
        </div>
      </div>
      <aside>
        <h2 className="mh-h">{t("What's new")}</h2>
        {!recent.length && <p className="muted small">{t("Nothing new yet.")}</p>}
        {recent.map((m) => (
          <p key={m.serial} className="mh-news"><b>{fmtTime(m.published_at)}</b> – <Link to={`/m/${m.serial}/catalog`}>{t("The {serial} spare parts catalogue was updated.", { serial: m.serial })}</Link></p>
        ))}
        <h2 className="mh-h">{t("Help")}</h2>
        <p className="small">{t("Pick a machine, open its Spare parts catalogue, then a group and a parts list. Click a part on the drawing or 3D model to find it in the list, set how many you need and press the cart. Send the cart to Ronchi America as a quote request.")}</p>
        <h2 className="mh-h">{t("Important links")}</h2>
        <p className="mh-links">
          <a href="https://www.ronchiamerica.com" target="_blank" rel="noopener noreferrer">Ronchi America</a>
          <a href="https://www.ronchi.it" target="_blank" rel="noopener noreferrer">Ronchi Mario (Italia)</a>
        </p>
        <span hidden>{lang}</span>
      </aside>
    </div>
  );
}

function Star({ kind, refId, on, onChange }: { kind: "machine" | "sheet"; refId: string; on: boolean; onChange: () => void }) {
  return (
    <button className="mv-ib mh-star" aria-pressed={on} title={on ? t("Favorite") : t("Add to favorites")} aria-label={on ? t("Favorite") : t("Add to favorites")} onClick={async () => {
      try {
        await api(`/favorites/${kind}/${enc(refId)}`, { method: on ? "DELETE" : "PUT", body: on ? undefined : {} });
        onChange();
      } catch (e) {
        toast(t((e as Error).message));
      }
    }}>{on ? IC.starOn : IC.star}<span className="mh-star-word">{on ? t("Saved") : t("Save")}</span></button>
  );
}

function useFavorites() {
  const f = useLoad(() => api("/favorites"));
  const has = (kind: string, ref: string) => !!f.data?.favorites.some((x: any) => x.kind === kind && x.ref === ref);
  return { has, reload: f.reload };
}

const machineCrumbs = (serial: string) => [{ label: t("All machines"), to: "/" }, { label: serial, to: `/m/${serial}` }];

/** One machine: its "Available content", like the Mario portal's machine page. */
function Machine({ serial }: { serial: string }) {
  useCurrentMachine(serial);
  const { data, error } = useLoad(() => api(`/machines/${enc(serial)}`), [serial]);
  if (error) return <Err error={error} />;
  if (!data) return null;
  const m = data.machine;
  const n = data.sheets.length;
  return (
    <>
      <Crumbs items={[...machineCrumbs(m.serial), { label: t("Available content") }]} L={Link} label={t("Where you are")} />
      <TilePage title={t("Available content")} lang={getLang()} tools={<span className="muted small">{[m.model, m.label].filter(Boolean).join(" · ")}</span>}>
        <Tile to={`/m/${m.serial}/catalog`} L={Link} pic={TILE.catalogue} label={t("Spare parts catalogue")} sub={n ? t("{n} parts lists", { n }) : t("Being prepared")} />
        <Tile to={`/m/${m.serial}/spares`} L={Link} pic={TILE.spares} label={t("Suggested spares")} sub={t("Wear parts to keep on the shelf")} />
        {n > 0 && <Tile to={`/book/${m.serial}`} L={Link} pic={TILE.book} label={t("Parts book (PDF)")} sub={t("Print or save drawings with their lists")} />}
      </TilePage>
      {!n && <p className="mv-note">{t("This machine's catalog isn't ready yet. Ronchi America is preparing it.")}</p>}
    </>
  );
}

function MachineCatalog({ serial, rest }: { serial: string; rest: string[] }) {
  useCurrentMachine(serial);
  const { data, error } = useLoad(() => api(`/machines/${enc(serial)}`), [serial]);
  if (error) return <Err error={error} />;
  if (!data) return null;
  return (
    <CatalogBrowse
      sheets={data.sheets as TreeSheet[]}
      level={levelFrom(rest)}
      base={`/m/${data.machine.serial}/catalog`}
      sheetTo={(s) => `/s/${s.id}`}
      thumb={(s) => (s.has_drawing ? `/api/sheets/${enc(s.id)}/drawing` : s.views?.length ? `/api/sheets/${enc(s.id)}/views/${s.views[0]}` : null)}
      L={Link}
      lang={getLang()}
      crumbs={[...machineCrumbs(data.machine.serial), { label: t("Available content"), to: `/m/${data.machine.serial}` }]}
    />
  );
}

function Spares({ serial }: { serial: string }) {
  useCurrentMachine(serial);
  const spares = useLoad(() => api(`/machines/${enc(serial)}/spares`), [serial]);
  return (
    <>
      <Crumbs items={[...machineCrumbs(serial), { label: t("Available content"), to: `/m/${serial}` }, { label: t("Suggested spares") }]} L={Link} label={t("Where you are")} />
      <TilePage title={t("Suggested spares")} lang={getLang()}>{null}</TilePage>
      <Err error={spares.error} />
      <p className="muted">{t("Parts on this machine that wear out. Keeping these on the shelf saves a stop.")}</p>
      {spares.data && !spares.data.spares.length && <p className="empty">{t("No wear parts marked for this machine yet.")}</p>}
      {!!spares.data?.spares.length && (
        <div className="pl">
          {spares.data.spares.map((p: any) => (
            <div key={p.code} className="pl-row">
              <span className="pl-pos" />
              <span className="pl-pic" aria-hidden="true">{IC.gearPart}</span>
              <span className="pl-what"><span className="pl-code"><b className="mono"><Link to={`/p/${p.code}`}>{p.code}</Link></b></span><small>{partName(getLang(), p)}</small><Link to={`/s/${p.sheet_id}`} className="cv-link">{t("Open its parts list")} ›</Link></span>
              <span className="pl-qty"><span>{t("Used on machine")}: {p.qty}{p.unit === "m" ? " m" : ""}</span><QtyCart code={p.code} serial={serial} qty={p.unit === "m" ? 1 : p.qty || 1} /></span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function Sheet({ id }: { id: string }) {
  const { data, error } = useLoad(() => api(`/sheets/${enc(id)}`), [id]);
  const tree = useLoad(() => (data ? api(`/machines/${enc(data.sheet.serial)}`) : Promise.resolve(null)), [data?.sheet.serial]);
  const fav = useFavorites();
  useCurrentMachine(data?.sheet.serial);
  if (error) return <Err error={error} />;
  if (!data) return null;
  const s = data.sheet;
  const rows: Row[] = data.rows;
  const all: TreeSheet[] = tree.data?.sheets ?? [];
  const grp = (x: { grp?: string | null; group?: string | null }) => (x.grp ?? x.group ?? "").trim() || "-";
  const siblings = all.filter((x) => x.section === s.section && grp(x) === grp(s)).map((x) => ({ id: x.id, code: x.code, title: x.title }));
  const base = `/m/${s.serial}/catalog`;
  const trail = [
    ...machineCrumbs(s.serial),
    { label: t("Available content"), to: `/m/${s.serial}` },
    { label: t("Spare parts catalogue"), to: base },
    { label: w(getLang(), SECTION_WORD[s.section as keyof typeof SECTION_WORD] as Word), to: `${base}/${s.section}` },
    ...(s.group ? [{ label: s.group, to: `${base}/${s.section}/${enc(grp(s))}` }] : []),
    ...s.path.map((p: any) => ({ label: [p.code, p.title].filter(Boolean).join(" - "), to: `/s/${p.id}` })),
    { label: [s.code, s.title].filter(Boolean).join(" - ") },
  ];
  return (
    <>
      <Crumbs items={trail} L={Link} label={t("Where this drawing sits")} />
      <SheetView
        sheet={s}
        rows={rows}
        lang={getLang()}
        fileUrl={(kind) => `/api/sheets/${enc(id)}/${kind}`}
        viewUrl={(v) => `/api/sheets/${enc(id)}/views/${v}`}
        pictureUrl={(code, v) => `/api/parts/${enc(code)}/picture?v=${enc(v)}`}
        onOpenSheet={(sid) => navigate(`/s/${sid}`)}
        partLink={(code) => <Link to={`/p/${code}`}>{code}</Link>}
        whereUsed={(code) => <Link to={`/p/${code}`}>{t("Show where this part is used")}</Link>}
        siblings={siblings}
        subtitle={s.rev ? `${t("Rev.")} ${s.rev}` : undefined}
        tools={<Star kind="sheet" refId={s.id} on={fav.has("sheet", s.id)} onChange={fav.reload} />}
        action={(r) => <QtyCart code={r.code} serial={s.serial} qty={r.qty && r.unit !== "m" ? r.qty : 1} />}
      />
    </>
  );
}

/** A parts book: pick drawings, then print them with their parts lists (or save as PDF from the print window). */
function Book({ serial }: { serial: string }) {
  useCurrentMachine(serial);
  const { data, error } = useLoad(() => api(`/machines/${enc(serial)}`), [serial]);
  const [chosen, setChosen] = useState<Set<string> | null>(null);
  const [pages, setPages] = useState<{ sheet: any; rows: Row[] }[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  if (error) return <Err error={error} />;
  if (!data) return null;
  const sheets: TreeSheet[] = data.sheets;
  const pick = chosen ?? new Set(sheets.map((s) => s.id));
  const build = async () => {
    const out: { sheet: any; rows: Row[] }[] = [];
    const ids = sheets.filter((s) => pick.has(s.id)).map((s) => s.id);
    try {
      for (const [i, id] of ids.entries()) {
        setBusy(t("Getting drawing {n} of {total}", { n: i + 1, total: ids.length }));
        const r = await api(`/sheets/${enc(id)}`);
        out.push({ sheet: r.sheet, rows: r.rows });
      }
      setPages(out);
    } catch (e) {
      toast(t((e as Error).message));
    } finally {
      setBusy(null);
    }
  };
  const lang = getLang();
  return (
    <>
      <div className="no-print">
        <nav className="crumbs"><Link to={`/m/${serial}`}>{serial}</Link></nav>
        <Head title={t("Parts book")} sub={t("Choose the drawings, build the book, then print it or save it as a PDF.")}>
          {pages ? (
            <>
              <button type="button" className="btn" onClick={() => setPages(null)}>{t("Change drawings")}</button>
              <button type="button" className="btn primary" onClick={() => window.print()}>{t("Print or save as PDF")}</button>
            </>
          ) : (
            <button type="button" className="btn primary" disabled={!pick.size || !!busy} onClick={build}>{busy ?? t("Build the book ({n} drawings)", { n: pick.size })}</button>
          )}
        </Head>
        {!pages && (
          <div className="panel stack">
            <div className="row">
              <button type="button" className="btn small" onClick={() => setChosen(new Set(sheets.map((s) => s.id)))}>{t("All")}</button>
              <button type="button" className="btn small" onClick={() => setChosen(new Set())}>{t("None")}</button>
            </div>
            {sheets.map((s) => (
              <label key={s.id} className="row book-pick">
                <input type="checkbox" checked={pick.has(s.id)} onChange={(e) => {
                  const n = new Set(pick);
                  e.target.checked ? n.add(s.id) : n.delete(s.id);
                  setChosen(n);
                }} />
                <span className="mono muted">{s.code ?? ""}</span> {s.title}
              </label>
            ))}
          </div>
        )}
      </div>
      {pages && (
        <div className="book">
          <section className="book-cover">
            <h1>{t("Parts book")}</h1>
            <p className="mono">{serial}</p>
            <p>{t("{n} drawings", { n: pages.length })} · {fmtTime(new Date().toISOString())}</p>
            <ol>{pages.map((p) => <li key={p.sheet.id}><span className="mono">{p.sheet.code ?? ""}</span> {p.sheet.title}</li>)}</ol>
          </section>
          {pages.map((p) => (
            <section key={p.sheet.id} className="book-page">
              <h2><span className="mono">{p.sheet.code ?? ""}</span> {p.sheet.title} <small className="muted mono">{serial}</small></h2>
              {p.sheet.drawing && <img src={`/api/sheets/${enc(p.sheet.id)}/drawing`} alt={p.sheet.title} />}
              {!p.sheet.drawing && !!p.sheet.views?.length && <img src={`/api/sheets/${enc(p.sheet.id)}/views/${p.sheet.views[0]}`} alt={p.sheet.title} />}
              <table className="book-rows">
                <thead><tr><th>{t("Pos.")}</th><th>{t("Part number")}</th><th>{t("Description")}</th><th>{t("Qty")}</th></tr></thead>
                <tbody>
                  {p.rows.map((r) => (
                    <tr key={r.id}><td>{r.pos}</td><td className="mono">{r.code}</td><td>{partName(lang, r)}{r.maker ? ` (${[r.maker, r.maker_pn].filter(Boolean).join(" ")})` : ""}</td><td>{r.qty ?? "–"}{r.unit === "m" ? " m" : ""}</td></tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      )}
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
      <Head title={t("Search")} sub={t("Find a machine by its number, or a part on any of your machines by its number, name, or the maker's part number.")} />
      <form className="row" onSubmit={(e) => { e.preventDefault(); navigate(`/search?q=${enc(text.trim())}`); }}>
        <input className="panel" style={{ flex: 1, padding: "10px 12px", font: "inherit" }} value={text} onChange={(e) => setText(e.target.value)} placeholder={t("Company, machine number, part number or name")} aria-label={t("Search parts")} />
        <button className="btn" type="submit">{t("Search")}</button>
      </form>
      <Err error={error} />
      {q && data && !data.results.length && !data.machines?.length && <p className="empty">{t("Nothing found on your machines for \"{q}\".", { q })}</p>}
      {!!data?.machines?.length && (
        <div className="mv-tiles">
          {data.machines.map((m: any) => <Tile key={m.serial} to={`/m/${m.serial}`} L={Link} pic={TILE.filler} label={m.serial} sub={m.label ?? m.model ?? undefined} />)}
        </div>
      )}
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
                  <td><QtyCart code={r.code} serial={r.serial} qty={1} /></td>
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
