// My look, language and alerts (saved to my login), and my devices.
import { useState } from "react";
import { api, fmtTime, type Me } from "../api";
import { PageHead, toast, useLoad } from "../components/ui";
import { LANGS, t } from "../i18n";
import { THEMES, type Prefs } from "../theme";

export function Settings({ me, prefs, onPrefs, onSignOut, sound, onSound }: {
  me: Me; prefs: Prefs | null; onPrefs: (p: Partial<Prefs> | { reset: true }) => void; onSignOut: () => void; sound: boolean; onSound: (on: boolean) => void;
}) {
  const devices = useLoad(() => api("/users/me/devices"));
  const [deviceLink, setDeviceLink] = useState<string | null>(null);

  function shuffle() {
    const others = THEMES.filter((th) => th.id !== prefs?.theme);
    onPrefs({ theme: others[Math.floor(Math.random() * others.length)]!.id });
  }
  async function addDevice() {
    try {
      const r = await api("/auth/add-device", { body: {} });
      setDeviceLink(r.link);
    } catch (e) {
      toast((e as Error).message);
    }
  }

  const swatch = (th: (typeof THEMES)[number]) => {
    const k = th.tokens ?? { bg: "#eceef1", solid: "#ffffff", accent: "#e30613", steel: "#15181c", ink: "#15181c" };
    return [k.steel, k.bg, k.solid, k.accent];
  };
  const lang = prefs?.lang ?? "en";
  const popups = prefs?.popups !== false;

  return (
    <>
      <PageHead title={t("Settings")} sub={`${me.name} · ${me.email}`}>
        <button className="btn" onClick={onSignOut}>{t("Sign out")}</button>
      </PageHead>
      <div className="grid g2">
        <div className="panel stack">
          <h2 style={{ margin: 0 }}>{t("Language")}</h2>
          <p className="muted" style={{ margin: 0 }}>{t("Menus, buttons and dates. Messages always show exactly as people wrote them.")}</p>
          <div className="row" role="radiogroup" aria-label={t("Language")}>
            {LANGS.map((l) => (
              <button key={l.id} className={`btn${lang === l.id ? " primary" : ""}`} role="radio" aria-checked={lang === l.id} onClick={() => onPrefs({ lang: l.id })}>{l.name}</button>
            ))}
          </div>
        </div>
        <div className="panel stack">
          <h2 style={{ margin: 0 }}>{t("New message alerts")}</h2>
          <label className="row switchrow">
            <input type="checkbox" checked={popups} onChange={(e) => onPrefs({ popups: e.target.checked })} />
            <span><b>{t("Pop-up alerts on this computer")}</b><small className="muted">{t("A small box at the bottom left when a message comes in while you're on another page.")}</small></span>
          </label>
          <label className="row switchrow">
            <input type="checkbox" checked={sound} onChange={(e) => onSound(e.target.checked)} />
            <span><b>{t("Alert sound")}</b><small className="muted">{t("A soft chime with each pop-up. Set on each device.")}</small></span>
          </label>
          <p className="muted" style={{ margin: 0 }}>{t("To silence one chat or board, open it and choose Mute alerts in its menu.")}</p>
        </div>
      </div>
      <div className="panel stack">
        <div className="row">
          <h2 style={{ margin: 0 }}>{t("Your look")}</h2>
          <span className="spacer" />
          <button className="btn" onClick={shuffle}>{t("Shuffle")}</button>
          <button className="btn" onClick={() => onPrefs({ reset: true })}>{t("Reset to Ronchi")}</button>
        </div>
        <p className="muted">{t("Saved to your login, so it follows you to your phone and computer.")}</p>
        {prefs?.theme === "ronchi" && (
          <div className="row" role="radiogroup" aria-label={t("Light or dark")}>
            {(["auto", "light", "dark"] as const).map((m) => (
              <button key={m} className={`btn small${prefs.mode === m ? " primary" : ""}`} onClick={() => onPrefs({ mode: m })} role="radio" aria-checked={prefs.mode === m}>
                {{ auto: t("Match my device"), light: t("Light"), dark: t("Dark") }[m]}
              </button>
            ))}
          </div>
        )}
        <div className="swatches">
          {THEMES.map((th) => (
            <button key={th.id} className="swatch" aria-pressed={prefs?.theme === th.id} onClick={() => onPrefs({ theme: th.id })}>
              <span className="bar">{swatch(th).map((c, i) => <i key={i} style={{ background: c }} />)}</span>
              <b>{th.name}</b>
              <small>{th.blurb}</small>
            </button>
          ))}
        </div>
        <p className="muted">{t("Home layouts (20 to pick from) and drag-to-arrange tiles arrive in Step 4.")}</p>
      </div>
      <div className="panel">
        <div className="row">
          <h2 style={{ margin: 0 }}>{t("Your devices")}</h2>
          <span className="spacer" />
          <button className="btn" onClick={addDevice}>{t("Add a phone or computer")}</button>
        </div>
        <table>
          <thead><tr><th>{t("Signed in on")}</th><th>{t("Last used")}</th><th /></tr></thead>
          <tbody>
            {devices.data?.sessions.map((s: any) => (
              <tr key={s.id}>
                <td>{describeAgent(s.user_agent)} {s.current && <span className="pill p-ok">{t("this device")}</span>}</td>
                <td>{fmtTime(s.last_seen_at)}</td>
                <td>{!s.current && <button className="btn small" onClick={async () => { await api(`/users/me/sessions/${encodeURIComponent(s.id)}/end`, { body: {} }); devices.reload(); }}>{t("Sign out")}</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {deviceLink && (
          <div className="stack" style={{ margin: "12px 0" }}>
            <b>{t("Open this link on the new phone or computer within 1 hour:")}</b>
            <code className="mono" style={{ overflowWrap: "anywhere" }}>{deviceLink}</code>
            <div className="row">
              <button className="btn small" onClick={() => navigator.clipboard.writeText(deviceLink).then(() => toast(t("Copied")))}>{t("Copy")}</button>
              <button className="btn small" onClick={() => setDeviceLink(null)}>{t("Done")}</button>
            </div>
          </div>
        )}
        <p className="muted">{t("Lost a phone? Sign it out here, or ask Paolo to sign you out everywhere.")}</p>
      </div>
    </>
  );
}

function describeAgent(ua: string): string {
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "Mac" : t("Device");
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /Firefox\//.test(ua) ? "Firefox" : "";
  return browser ? `${os}, ${browser}` : os;
}
