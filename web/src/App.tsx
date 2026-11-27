import logoUrl from "./assets/ronchi-logo.png";
// The staff app shell: top bar with the account menu, the L2 menu (a bar under the header; a bottom
// tab bar on phones), new-message alerts, and the page for the current address.
import { useEffect, useState } from "react";
import { api, can, type Me } from "./api";
import { Alerts, initials, setSound, soundOn, type Unread } from "./components/Alerts";
import { Chevron } from "./components/icons";
import { Menu, type MenuItem } from "./components/Menu";
import { Link, toast } from "./components/ui";
import { isLang, LANGS, setLang, t, useLang } from "./i18n";
import { DEMO, goBack, navigate, usePath } from "./router";
import { applyTheme, type Prefs } from "./theme";
import { SignIn } from "./pages/SignIn";
import { Welcome } from "./pages/Welcome";
import { Home } from "./pages/Home";
import { Boards, BoardPage, Chats } from "./pages/Boards";
import { ChangePartPage, ChangeParts } from "./pages/ChangeParts";
import { Inventory, InventoryImport, InventoryPart } from "./pages/Inventory";
import { MachineDealPage, MachineSales, NewMachineDeal } from "./pages/MachineSales";
import { NewPartsOrder, PartsOrderPage, PartsOrders } from "./pages/PartsOrders";
import { Machines, MachinePage } from "./pages/Machines";
import { KbArticle, KnowledgeBase } from "./pages/Knowledge";
import { People } from "./pages/People";
import { Catalog } from "./pages/Catalog";
import { Customers, Quotes } from "./pages/Customers";
import { Settings } from "./pages/Settings";
import { JobList, JobPage, NewJob } from "./pages/Jobs";
import { BillingWeek } from "./pages/Workbook";
import { WorkbookPage } from "./pages/FieldServiceWorkbook";
import { Learn } from "./pages/Learn";
import { NewShipment, ShipmentPage, Shipping } from "./pages/Shipping";
import { fromOldAddress, groupedMenu, menuFor, pageAllowed, type NavItem } from "./nav";
import { roleLabel, useRoleNames } from "./roles";

// Chrome and Edge offer to install the portal as an app (own window, icon on the desktop or home screen).
// The offer arrives once, early, so it is kept here until someone picks "Install as an app".
interface InstallOffer extends Event { prompt: () => Promise<void> }
let installOffer: InstallOffer | null = null;
const installListeners = new Set<() => void>();
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installOffer = e as InstallOffer;
  installListeners.forEach((f) => f());
});
window.addEventListener("appinstalled", () => {
  installOffer = null;
  installListeners.forEach((f) => f());
});
function useInstallPrompt() {
  const [ready, setReady] = useState(() => !!installOffer);
  useEffect(() => {
    const f = () => setReady(!!installOffer);
    installListeners.add(f);
    return () => void installListeners.delete(f);
  }, []);
  return {
    ready,
    run: async () => {
      const offer = installOffer;
      if (!offer) return;
      installOffer = null;
      setReady(false);
      await offer.prompt().catch(() => undefined);
    },
  };
}

export const DEFAULT_PREFS: Prefs = { theme: "ronchi", mode: "auto", layout: "L2", tiles: null, lang: "en", popups: true };

export function App() {
  const typed = usePath();
  // Work orders used to be their own pages; old links and emails open the job's Work order tab.
  const path = fromOldAddress(typed);
  useEffect(() => {
    if (path !== typed && !DEMO) history.replaceState(null, "", path);
  }, [path, typed]);
  const lang = useLang();
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  useRoleNames(me?.id);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [unread, setUnread] = useState<Unread>({ boards: 0, chats: 0 });
  const [sound, setSoundState] = useState(soundOn);
  // Whole parts of the portal an admin can switch off (Settings). The Ronchi workbook is on unless switched off.
  const install = useInstallPrompt();
  const [switches, setSwitches] = useState<{ workbook: boolean }>({ workbook: true });

  const refresh = () => api<{ user: Me | null; settings?: Me["settings"] }>("/auth/me").then((r) => setMe(r.user ? { ...r.user, settings: r.settings } : null), () => setMe(null));
  useEffect(() => void refresh(), []);
  useEffect(() => {
    if (!me) return;
    api<{ switches: { workbook: boolean } }>("/switches").then((r) => setSwitches(r.switches), () => undefined);
    api<Prefs>("/prefs").then((p) => {
      setPrefs(p);
      applyTheme(p);
      if (isLang(p.lang)) setLang(p.lang);
    });
  }, [me]);

  async function savePrefs(next: Partial<Prefs> | { reset: true }) {
    try {
      const p = await api<Prefs>("/prefs", { method: "PUT", body: "reset" in next ? next : { ...(prefs ?? DEFAULT_PREFS), ...next } });
      setPrefs(p);
      applyTheme(p);
      if (isLang(p.lang)) setLang(p.lang);
    } catch (e) {
      toast((e as Error).message);
    }
  }
  async function signOut() {
    try {
      await api("/auth/logout", { body: {} });
      refresh();
    } catch (e) {
      toast((e as Error).message);
    }
  }

  const brand = me?.settings?.brand ?? { name: "Ronchi Portal", company: "Ronchi America", notice: "" };
  useEffect(() => {
    document.title = brand.name;
  }, [brand.name]);
  const langs = LANGS.filter((l) => !me?.settings || me.settings.languages.allowed.includes(l.id));

  if (path === "/welcome") return <Welcome onDone={refresh} />;
  if (me === undefined) return <div className="boot" aria-busy="true" />;
  if (me === null) return <SignIn onDone={refresh} />;

  const items = menuFor(new Set(me.permissions), switches);
  const section = "/" + (path.split("/")[1] ?? "");
  const popups = prefs?.popups !== false;

  let page;
  const m = /^\/(boards|machines|chats|change-parts|jobs)\/([A-Za-z0-9_-]+)$/.exec(path);
  const wo = /^\/jobs\/([A-Za-z0-9_-]+)\/work-order$/.exec(path);
  const po = /^\/parts-orders(?:\/([A-Za-z0-9_-]+))?$/.exec(path);
  const ms = /^\/machine-sales(?:\/([A-Za-z0-9_-]+))?$/.exec(path);
  const inv = /^\/inventory(?:\/(.+))?$/.exec(path);
  if (inv && !inv[1]) page = <Inventory me={me} />;
  else if (inv && inv[1] === "import") page = <InventoryImport me={me} />;
  else if (inv) page = <InventoryPart key={inv[1]} code={decodeURIComponent(inv[1]!)} me={me} />;
  else if (ms && ms[1] === "new") page = <NewMachineDeal me={me} />;
  else if (ms && (!ms[1] || ["list", "orders", "hold", "closed"].includes(ms[1]))) page = <MachineSales key={path} me={me} tab={ms[1]} />;
  else if (ms) page = <MachineDealPage key={ms[1]} id={ms[1]!} me={me} />;
  else if (po && (po[1] === "new")) page = <NewPartsOrder me={me} />;
  else if (po && (!po[1] || po[1] === "to-order" || po[1] === "reports")) page = <PartsOrders key={path} me={me} tab={po[1]} />;
  else if (po) page = <PartsOrderPage key={po[1]} id={po[1]!} me={me} />;
  else if (m?.[1] === "boards" || m?.[1] === "chats") page = <BoardPage key={m[2]} id={m[2]!} me={me} />;
  else if (m?.[1] === "machines") page = <MachinePage id={m[2]!} me={me} />;
  else if (path === "/jobs/new") page = <NewJob me={me} />;
  else if (path === "/jobs/workbook") page = switches.workbook ? <WorkbookPage me={me} /> : <JobList me={me} workbook={false} />;
  else if (path === "/jobs/billing") page = switches.workbook ? <BillingWeek me={me} /> : <JobList me={me} workbook={false} />;
  else if (m?.[1] === "jobs") page = <JobPage key={m[2]} id={m[2]!} me={me} />;
  else if (wo) page = <JobPage key={wo[1]} id={wo[1]!} me={me} tab="work-order" />;
  else if (section === "/jobs") page = <JobList me={me} workbook={switches.workbook} />;
  else if (/^\/kb\/[A-Za-z0-9_-]+$/.test(path)) page = <KbArticle key={path} id={path.slice(4)} me={me} />;
  else if (section === "/kb") page = <KnowledgeBase me={me} />;
  else if (section === "/catalog") page = <Catalog me={me} path={path} />;
  else if (section === "/customers") page = <Customers me={me} />;
  else if (section === "/quotes") page = <Quotes key={path} me={me} id={/^\/quotes\/([A-Za-z0-9_-]+)$/.exec(path)?.[1]} />;
  else if (path === "/shipping/new") page = <NewShipment key={path} />;
  else if (/^\/shipping\/[A-Za-z0-9_-]+$/.test(path)) page = <ShipmentPage key={path} id={path.slice(10)} me={me} />;
  else if (section === "/shipping") page = <Shipping me={me} />;
  else if (m?.[1] === "change-parts" && m[2] === "sales") page = <ChangeParts me={me} tab="sales" />;
  else if (m?.[1] === "change-parts") page = <ChangePartPage key={m[2]} id={m[2]!} me={me} />;
  else if (section === "/chats") page = <Chats me={me} />;
  else if (section === "/boards") page = <Boards me={me} />;
  else if (section === "/machines") page = <Machines me={me} />;
  else if (section === "/change-parts") page = <ChangeParts me={me} />;
  else if (section === "/people") page = <People me={me} />;
  else if (section === "/learn") page = <Learn me={me} />;
  else if (section === "/settings") page = <Settings me={me} admin={path === "/settings/admin"} prefs={prefs} switches={switches} onSwitches={setSwitches} onPrefs={savePrefs} onSignOut={signOut} sound={sound} onSound={(on) => { setSound(on); setSoundState(on); }} onSettings={(s) => setMe({ ...me, settings: s })} />;
  else page = <Home me={me} unread={unread} />;
  if (!pageAllowed(path, new Set(me.permissions))) {
    page = (
      <section>
        <h1>{t("No access")}</h1>
        <p className="sub">{t("Your role doesn't allow this.")} {t("Ask an admin if you need it.")}</p>
        <Link to="/" className="btn">{t("Home")}</Link>
      </section>
    );
  }

  const account: MenuItem[] = [
    { heading: me.name, sub: me.email },
    ...langs.map((l): MenuItem => ({ label: l.name, role: "radio", checked: lang === l.id, onSelect: () => savePrefs({ lang: l.id }) })),
    "sep",
    { label: t("Pop-up alerts on this computer"), role: "checkbox", checked: popups, onSelect: () => savePrefs({ popups: !popups }) },
    { label: t("Alert sound"), role: "checkbox", checked: sound, onSelect: () => { setSound(!sound); setSoundState(!sound); } },
    { label: t("Mark all chats and boards read"), onSelect: async () => { await api("/boards/read-all", { body: {} }).catch(() => undefined); setUnread({ boards: 0, chats: 0 }); toast(t("All marked as read")); }, hidden: !can(me, "boards.use") },
    "sep",
    { label: t("Install as an app"), onSelect: install.run, hidden: !install.ready },
    { label: t("Portal training"), onSelect: () => navigate("/learn") },
    { label: t("Settings"), onSelect: () => navigate("/settings") },
    { label: t("Command center"), hint: t("Owner"), onSelect: () => navigate("/settings/admin"), hidden: !can(me, "settings.manage") },
    { label: t("People and access"), hint: t("Admin"), onSelect: () => navigate("/people"), hidden: !can(me, "users.manage") },
    { label: t("Archived boards"), hint: t("Admin"), onSelect: () => navigate("/boards"), hidden: !can(me, "boards.moderate") || !can(me, "users.manage") },
    "sep",
    { label: t("Sign out"), danger: true, onSelect: signOut },
  ];

  return (
    <>
      <header className="top">
        <div className="wrap">
          <Link to="/" className="brand">
            <img src={logoUrl} alt="Ronchi" />
            <span>
              {brand.name}<small>{brand.company}</small>
            </span>
          </Link>
          <span className="spacer" />
          <Menu
            label={t("Account menu")}
            className="who"
            trigger={
              <>
                <span className="avatar person sm" aria-hidden="true">{initials(me.name)}</span>
                <span className="who-text">{me.name}<small>{roleLabel(me.role)}</small></span>
                <Chevron />
              </>
            }
            items={account}
          />
        </div>
      </header>
      {brand.notice && (
        <div className="notice-strip" role="status">
          <div className="wrap">{brand.notice}</div>
        </div>
      )}
      {import.meta.env.MODE === "demo" && (
        <div className="note">
          <div className="wrap row">
            <span>{t("Preview with example data, signed in as you. People, customers and messages shown are examples. Changes are not saved and reset when you reload.")}</span>
            <button className="linkish" onClick={() => { location.hash = "#home"; location.reload(); }}>{t("Reset examples")}</button>
          </div>
        </div>
      )}
      <div className="wrap" key={lang}>
        <div className="shell">
          <nav className="side" aria-label={t("Main")}>
            {groupedMenu(items).map((e) => {
              const isHere = (n: NavItem) => (n.to === "/" ? path === "/" : section === n.to);
              const badge = (count: number) => count > 0 && <span className="navcount" aria-label={t("{n} unread", { n: count })}>{count > 99 ? "99+" : count}</span>;
              if ("page" in e) {
                const n = e.page;
                return (
                  <Link key={n.to} to={n.to} current={isHere(n)} className={n.phone === false ? "desk-only" : undefined}>
                    {t(n.label)}
                    {badge(n.count ? unread[n.count] : 0)}
                  </Link>
                );
              }
              const total = e.pages.reduce((sum, n) => sum + (n.count ? unread[n.count] : 0), 0);
              return (
                <Menu
                  key={e.group}
                  label={t(e.group)}
                  align="left"
                  className={`navgroup${e.pages.some(isHere) ? " here" : ""}${e.pages.every((n) => n.phone === false) ? " desk-only" : ""}`}
                  trigger={<>{t(e.group)}{badge(total)}<Chevron /></>}
                  items={e.pages.map((n) => {
                    const count = n.count ? unread[n.count] : 0;
                    return { label: t(n.label), hint: count > 0 ? t("{n} unread", { n: count }) : undefined, onSelect: () => navigate(n.to), role: "radio" as const, checked: isHere(n) };
                  })}
                />
              );
            })}
          </nav>
          <main>
            {path !== "/" && (
              <button type="button" className="back" onClick={goBack}>
                <span aria-hidden="true">←</span> {t("Back")}
              </button>
            )}
            {page}
          </main>
        </div>
      </div>
      {can(me, "boards.use") && <Alerts me={me} path={path} popups={popups} onUnread={setUnread} />}
    </>
  );
}
