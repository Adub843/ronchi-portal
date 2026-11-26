// My look, language and alerts (saved to my login), and my devices.
// The portal owner also gets a second tab, Command center (pages/AdminSettings.tsx).
import { useState } from "react";
import { api, can, fmtTime, type Me } from "../api";
import { ErrorNote, Link, PageHead, toast, useLoad, Tip } from "../components/ui";
import { AdminSettings } from "./AdminSettings";
import { showAllTips, useHiddenTipCount } from "../tips";
import { LANGS, t } from "../i18n";
import { THEMES, type Prefs } from "../theme";

type Switches = { workbook: boolean };

export function Settings({ me, admin, prefs, onPrefs, onSignOut, sound, onSound, switches, onSwitches, onSettings }: {
  me: Me; admin?: boolean; prefs: Prefs | null; switches: Switches; onSwitches: (s: Switches) => void; onPrefs: (p: Partial<Prefs> | { reset: true }) => void; onSignOut: () => void; sound: boolean; onSound: (on: boolean) => void;
  onSettings: (s: NonNullable<Me["settings"]>) => void;
}) {
  const isAdmin = can(me, "settings.manage");
  const tabs = isAdmin && (
    <div className="tabs-row" role="tablist" aria-label={t("Settings")}>
      <Link to="/settings" className={`btn${admin ? "" : " primary"}`} current={!admin}>{t("My settings")}</Link>
      <Link to="/settings/admin" className={`btn${admin ? " primary" : ""}`} current={admin}>{t("Command center")}</Link>
    </div>
  );
  if (admin && isAdmin) {
    return (
      <>
        <PageHead title={t("Command center")} sub={t("Every switch and control for the portal, in one place. Only you see this.")} />
        {tabs}
        <AdminSettings onSaved={(s) => onSettings(s)} switches={switches} onSwitches={onSwitches} />
      </>
    );
  }
  return <MySettings me={me} tabs={tabs} prefs={prefs} switches={switches} onSwitches={onSwitches} onPrefs={onPrefs} onSignOut={onSignOut} sound={sound} onSound={onSound} />;
}

function MySettings({ me, tabs, prefs, onPrefs, onSignOut, sound, onSound, switches, onSwitches }: {
  me: Me; tabs: React.ReactNode; prefs: Prefs | null; switches: Switches; onSwitches: (s: Switches) => void; onPrefs: (p: Partial<Prefs> | { reset: true }) => void; onSignOut: () => void; sound: boolean; onSound: (on: boolean) => void;
}) {
  const devices = useLoad(() => api("/users/me/devices"));
  const [pw, setPw] = useState<{ current: string; next: string; again: string } | null>(null);
  const [pwError, setPwError] = useState<string | null>(null);

  // Only the looks and languages an admin allows (Settings > Command center).
  const themes = THEMES.filter((th) => !me.settings || me.settings.look.allowedThemes.includes(th.id));
  const langs = LANGS.filter((l) => !me.settings || me.settings.languages.allowed.includes(l.id));
  function shuffle() {
    const others = themes.filter((th) => th.id !== prefs?.theme);
    if (!others.length) return;
    onPrefs({ theme: others[Math.floor(Math.random() * others.length)]!.id });
  }
  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (!pw) return;
    setPwError(null);
    if (pw.next !== pw.again) return setPwError(t("The two passwords don't match."));
    try {
      await api("/auth/password/change", { body: { current: pw.current, password: pw.next } });
      setPw(null);
      devices.reload();
      toast(t("Password changed. Your other devices were signed out."));
    } catch (x) {
      setPwError((x as Error).message);
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
      {tabs}
      <div className="grid g2">
        <div className="panel stack">
          <h2 style={{ margin: 0 }}>{t("Language")}</h2>
          <Tip id="settings.language">{t("Menus, buttons and dates. Messages always show exactly as people wrote them.")}</Tip>
          <div className="row" role="radiogroup" aria-label={t("Language")}>
            {langs.map((l) => (
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
      <div className="panel stack">
        <div className="row">
          <h2 style={{ margin: 0 }}>{t("Your look")}</h2>
          <span className="spacer" />
          {themes.length > 1 && <button className="btn" onClick={shuffle}>{t("Shuffle")}</button>}
          <button className="btn" onClick={() => onPrefs({ reset: true })}>{me.settings && me.settings.look.defaultTheme !== "ronchi" ? t("Reset to the starting look") : t("Reset to Ronchi")}</button>
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
          {themes.map((th) => (
            <button key={th.id} className="swatch" aria-pressed={prefs?.theme === th.id} onClick={() => onPrefs({ theme: th.id })}>
              <span className="bar">{swatch(th).map((c, i) => <i key={i} style={{ background: c }} />)}</span>
              <b>{th.name}</b>
              <small>{t(th.blurb)}</small>
            </button>
          ))}
        </div>
        <Tip id="settings.layouts">{t("Home layouts (20 to pick from) and drag-to-arrange tiles arrive in Step 4.")}</Tip>
      </div>
      <div className="panel">
        <div className="row">
          <h2 style={{ margin: 0 }}>{t("Your devices")}</h2>
          <span className="spacer" />
          <button className="btn" onClick={() => { setPw(pw ? null : { current: "", next: "", again: "" }); setPwError(null); }}>{t("Change password")}</button>
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
        {pw && (
          <form className="grid g2" style={{ margin: "12px 0" }} onSubmit={changePassword}>
            <div className="field"><label htmlFor="pw-cur">{t("Current password")}</label><input id="pw-cur" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required maxLength={200} /></div>
            <div className="field"><label htmlFor="pw-new">{t("New password")}</label><input id="pw-new" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} required minLength={8} maxLength={200} /></div>
            <div className="field"><label htmlFor="pw-again">{t("New password again")}</label><input id="pw-again" type="password" autoComplete="new-password" value={pw.again} onChange={(e) => setPw({ ...pw, again: e.target.value })} required maxLength={200} /></div>
            <ErrorNote error={pwError} />
            <div className="row">
              <button className="btn primary" type="submit">{t("Save password")}</button>
              <button className="btn" type="button" onClick={() => setPw(null)}>{t("Cancel")}</button>
            </div>
          </form>
        )}
        <Tip id="settings.lost-phone">{t("Lost a phone? Sign it out here, or ask your admin to sign you out everywhere.")}</Tip>
      </div>
    </>
  );
}

function describeAgent(ua: string): string {
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "Mac" : t("Device");
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /Firefox\//.test(ua) ? "Firefox" : "";
  return browser ? `${os}, ${browser}` : os;
}
