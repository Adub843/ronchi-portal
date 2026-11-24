import logoUrl from "../assets/ronchi-logo.png";
import { useState } from "react";
import { startAuthentication } from "@simplewebauthn/browser";
import { api } from "../api";
import { ErrorNote } from "../components/ui";
import { LANGS, setLang, t, useLang } from "../i18n";

export function SignIn({ onDone }: { onDone: () => void }) {
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
          <h1>Ronchi Portal</h1>
          <p className="sub">{t("Staff sign-in. Use Face ID, your fingerprint, Windows Hello or your device PIN.")}</p>
        </div>
        <button className="btn primary" onClick={signIn} disabled={busy}>
          {busy ? t("Waiting for your passkey…") : t("Sign in with passkey")}
        </button>
        <ErrorNote error={error} />
        <p className="muted">{t("New here, or on a new phone? Ask Paolo for an invite link.")}</p>
        <div className="row langrow" role="radiogroup" aria-label={t("Language")}>
          {LANGS.map((l) => <button key={l.id} type="button" className={`linkish${lang === l.id ? " on" : ""}`} role="radio" aria-checked={lang === l.id} onClick={() => setLang(l.id)}>{l.name}</button>)}
        </div>
      </div>
    </div>
  );
}
