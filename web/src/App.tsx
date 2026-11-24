import logoUrl from "./assets/ronchi-logo.png";
// The staff app shell: top bar, the L2 menu (a bar under the header; a bottom tab bar on phones),
// and the page for the current address.
import { useEffect, useState } from "react";
import { api, can, type Me } from "./api";
import { Link } from "./components/ui";
import { goBack, usePath } from "./router";
import { applyTheme, type Prefs } from "./theme";
import { SignIn } from "./pages/SignIn";
import { Welcome } from "./pages/Welcome";
import { Home } from "./pages/Home";
import { Boards, BoardPage } from "./pages/Boards";
import { Machines, MachinePage } from "./pages/Machines";
import { People } from "./pages/People";
import { Settings } from "./pages/Settings";

const NAV: { to: string; label: string; perm?: string }[] = [
  { to: "/", label: "Home" },
  { to: "/boards", label: "Boards", perm: "boards.use" },
  { to: "/machines", label: "Machines", perm: "machines.view" },
  { to: "/people", label: "People", perm: "users.manage" },
  { to: "/settings", label: "Settings" },
];

export function App() {
  const path = usePath();
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [prefs, setPrefs] = useState<Prefs | null>(null);

  const refresh = () => api<{ user: Me | null }>("/auth/me").then((r) => setMe(r.user), () => setMe(null));
  useEffect(() => void refresh(), []);
  useEffect(() => {
    if (!me) return;
    api<Prefs>("/prefs").then((p) => {
      setPrefs(p);
      applyTheme(p);
    });
  }, [me]);

  if (path === "/welcome") return <Welcome onDone={refresh} />;
  if (me === undefined) return <div className="boot" aria-busy="true" />;
  if (me === null) return <SignIn onDone={refresh} />;

  const items = NAV.filter((n) => !n.perm || can(me, n.perm));
  const section = "/" + (path.split("/")[1] ?? "");

  let page;
  const m = /^\/(boards|machines)\/([A-Za-z0-9_-]+)$/.exec(path);
  if (m?.[1] === "boards") page = <BoardPage id={m[2]!} me={me} />;
  else if (m?.[1] === "machines") page = <MachinePage id={m[2]!} me={me} />;
  else if (section === "/boards") page = <Boards me={me} />;
  else if (section === "/machines") page = <Machines me={me} />;
  else if (section === "/people") page = <People me={me} />;
  else if (section === "/settings") page = <Settings me={me} prefs={prefs} onPrefs={(p) => { setPrefs(p); applyTheme(p); }} onSignOut={refresh} />;
  else page = <Home me={me} />;

  return (
    <>
      <header className="top">
        <div className="wrap">
          <Link to="/" className="brand">
            <img src={logoUrl} alt="Ronchi" />
            <span>
              Ronchi Portal<small>Ronchi America</small>
            </span>
          </Link>
          <span className="spacer" />
          <span className="who">
            {me.name}
            <small>{me.role}</small>
          </span>
        </div>
      </header>
      {import.meta.env.MODE === "demo" && (
        <div className="note">
          <div className="wrap row">
            <span>Preview with example data, signed in as you. Customers, sites and messages shown are examples. Changes are not saved and reset when you reload.</span>
            <button className="linkish" onClick={() => { location.hash = "#home"; location.reload(); }}>Reset examples</button>
          </div>
        </div>
      )}
      <div className="wrap">
        <div className="shell">
          <nav className="side" aria-label="Main">
            {items.map((n) => (
              <Link key={n.to} to={n.to} current={n.to === "/" ? path === "/" : section === n.to}>
                {n.label}
              </Link>
            ))}
          </nav>
          <main>
            {path !== "/" && (
              <button type="button" className="back" onClick={goBack}>
                <span aria-hidden="true">←</span> Back
              </button>
            )}
            {page}
          </main>
        </div>
      </div>
    </>
  );
}
