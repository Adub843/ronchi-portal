// My look, language and alerts (saved to my login), and my devices.
import { useState } from "react";
import { api, can, fmtTime, type Me } from "../api";
import { PageHead, toast, useLoad, Tip } from "../components/ui";
import { showAllTips, useHiddenTipCount } from "../tips";
import { LANGS, t } from "../i18n";
import { THEMES, type Prefs } from "../theme";

export function Settings({ me, prefs, onPrefs, onSignOut, sound, onSound, switches, onSwitches }: {
  me: Me; prefs: Prefs | null; switches: { workbook: boolean }; onSwitches: (s: { workbook: boolean }) => void; onPrefs: (p: Partial<Prefs> | { reset: true }) => void; onSignOut: () => void; sound: boolean; onSound: (on: boolean) => void;
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
  const tipCount = useHiddenTipCount();
  const popups = prefs?.popups !== false;

  return (
    <>
      <PageHead title={t("Settings")} sub={`${me.name} · ${me.email}`}>
        <button className="btn" onClick={onSignOut}>{t("Sign out")}</button>
      </PageHead>
      <div className="grid g2">
        <div className="panel stack">
          <h2 style={{ margin: 0 }}>{t("Language")}</h2>
          <Tip id="settings.language">{t("Menus, buttons and dates. Messages always show exactly as people wrote them.")}</Tip>
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
          <Tip id="settings.mute">{t("To silence one chat or board, open it and choose Mute alerts in its menu.")}</Tip>
        </div>
      </div>
      {can(me, "users.manage") && (
        <div className="panel stack">
          <h2 style={{ margin: 0 }}>{t("Ronchi workbook")}</h2>
          <label className="row switchrow">
            <input type="checkbox" checked={switches.workbook} onChange={async (e) => {
              const on = e.target.checked;
              if (!on && !window.confirm(t("Switch the Ronchi workbook off for everyone? Work orders leave the menu. Jobs, job emails and job files keep working, and nothing is deleted."))) return;
              try {
                const r = await api("/switches/workbook", { method: "PUT", body: { on } });
                onSwitches(r.switches);
                toast(on ? t("The Ronchi workbook is on") : t("The Ronchi workbook is off"));
              } catch (x) {
                toast((x as Error).message);
              }
            }} />
            <span><b>{t("Use the Ronchi workbook (Work orders)")}</b><small className="muted">{t("On: each job has a work order with the machine's log of past work orders, and the field service engineer's email opens it. Off: for teams that keep their Excel sheets. Jobs, job emails and files keep working; switching back on brings everything back.")}</small></span>
          </label>
        </div>
      )}
      <div className="panel stack">
        <div className="row">
          <h2 style={{ margin: 0 }}>{t("Your look")}</h2>
          <span className="spacer" />
          <button className="btn" onClick={shuffle}>{t("Shuffle")}</button>
          <button className="btn" onClick={() => onPrefs({ reset: true })}>{t("Reset to Ronchi")}</button>
          <button className="btn" disabled={!tipCount} title={t("Bring back the instruction notes you closed with the ×")} onClick={() => showAllTips().then(() => toast(t("Tips are back on every page.")), () => toast(t("Couldn't bring the tips back. Try again.")))}>
            {tipCount ? t("Show {n} hidden tips", { n: tipCount }) : t("No hidden tips")}
          </button>
        </div>
        <Tip id="settings.look">{t("Saved to your login, so it follows you to your phone and computer.")}</Tip>
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
        <Tip id="settings.layouts">{t("Home layouts (20 to pick from) and drag-to-arrange tiles arrive in Step 4.")}</Tip>
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
        <Tip id="settings.lost-phone">{t("Lost a phone? Sign it out here, or ask Paolo to sign you out everywhere.")}</Tip>
      </div>
    </>
  );
}

function describeAgent(ua: string): string {
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "Mac" : t("Device");
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /Firefox\//.test(ua) ? "Firefox" : "";
  return browser ? `${os}, ${browser}` : os;
}
