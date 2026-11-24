// My look (saved to my login) and my devices.
import { useState } from "react";
import { api, fmtTime, type Me } from "../api";
import { PageHead, toast, useLoad } from "../components/ui";
import { THEMES, type Prefs } from "../theme";

export function Settings({ me, prefs, onPrefs, onSignOut }: { me: Me; prefs: Prefs | null; onPrefs: (p: Prefs) => void; onSignOut: () => void }) {
  const devices = useLoad(() => api("/users/me/devices"));
  const [deviceLink, setDeviceLink] = useState<string | null>(null);

  async function save(next: Partial<Prefs> | { reset: true }) {
    try {
      const body = "reset" in next ? next : { ...(prefs ?? { theme: "ronchi", mode: "auto", layout: "L2", tiles: null }), ...next };
      onPrefs(await api<Prefs>("/prefs", { method: "PUT", body }));
    } catch (e) {
      toast((e as Error).message);
    }
  }
  function shuffle() {
    const others = THEMES.filter((t) => t.id !== prefs?.theme);
    save({ theme: others[Math.floor(Math.random() * others.length)]!.id });
  }
  async function addDevice() {
    try {
      const r = await api("/auth/add-device", { body: {} });
      setDeviceLink(r.link);
    } catch (e) {
      toast((e as Error).message);
    }
  }
  async function signOut() {
    await api("/auth/logout", { body: {} });
    onSignOut();
  }

  const swatch = (t: (typeof THEMES)[number]) => {
    const k = t.tokens ?? { bg: "#eceef1", solid: "#ffffff", accent: "#e30613", steel: "#15181c", ink: "#15181c" };
    return [k.steel, k.bg, k.solid, k.accent];
  };

  return (
    <>
      <PageHead title="Settings" sub={`${me.name} · ${me.email}`}>
        <button className="btn" onClick={signOut}>Sign out</button>
      </PageHead>
      <div className="panel stack">
        <div className="row">
          <h2 style={{ margin: 0 }}>Your look</h2>
          <span className="spacer" />
          <button className="btn" onClick={shuffle}>Shuffle</button>
          <button className="btn" onClick={() => save({ reset: true })}>Reset to Ronchi</button>
        </div>
        <p className="muted">Saved to your login, so it follows you to your phone and computer.</p>
        {prefs?.theme === "ronchi" && (
          <div className="row" role="radiogroup" aria-label="Light or dark">
            {(["auto", "light", "dark"] as const).map((m) => (
              <button key={m} className={`btn small${prefs.mode === m ? " primary" : ""}`} onClick={() => save({ mode: m })} role="radio" aria-checked={prefs.mode === m}>
                {{ auto: "Match my device", light: "Light", dark: "Dark" }[m]}
              </button>
            ))}
          </div>
        )}
        <div className="swatches">
          {THEMES.map((t) => (
            <button key={t.id} className="swatch" aria-pressed={prefs?.theme === t.id} onClick={() => save({ theme: t.id })}>
              <span className="bar">{swatch(t).map((c, i) => <i key={i} style={{ background: c }} />)}</span>
              <b>{t.name}</b>
              <small>{t.blurb}</small>
            </button>
          ))}
        </div>
        <p className="muted">Home layouts (20 to pick from) and drag-to-arrange tiles arrive in Step 4.</p>
      </div>
      <div className="panel">
        <div className="row">
          <h2 style={{ margin: 0 }}>Your devices</h2>
          <span className="spacer" />
          <button className="btn" onClick={addDevice}>Add a phone or computer</button>
        </div>
        <table>
          <thead><tr><th>Signed in on</th><th>Last used</th><th /></tr></thead>
          <tbody>
            {devices.data?.sessions.map((s: any) => (
              <tr key={s.id}>
                <td>{describeAgent(s.user_agent)} {s.current && <span className="pill p-ok">this device</span>}</td>
                <td>{fmtTime(s.last_seen_at)}</td>
                <td>{!s.current && <button className="btn small" onClick={async () => { await api(`/users/me/sessions/${s.id}/end`, { body: {} }); devices.reload(); }}>Sign out</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {deviceLink && (
          <div className="stack" style={{ margin: "12px 0" }}>
            <b>Open this link on the new phone or computer within 1 hour:</b>
            <code className="mono" style={{ overflowWrap: "anywhere" }}>{deviceLink}</code>
            <div className="row">
              <button className="btn small" onClick={() => navigator.clipboard.writeText(deviceLink).then(() => toast("Copied"))}>Copy</button>
              <button className="btn small" onClick={() => setDeviceLink(null)}>Done</button>
            </div>
          </div>
        )}
        <p className="muted">Lost a phone? Sign it out here, or ask Paolo to sign you out everywhere.</p>
      </div>
    </>
  );
}

function describeAgent(ua: string): string {
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "Mac" : "Device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /Firefox\//.test(ua) ? "Firefox" : "";
  return browser ? `${os}, ${browser}` : os;
}
