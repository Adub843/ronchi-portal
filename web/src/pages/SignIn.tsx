import logoUrl from "../assets/ronchi-logo.png";
// Sign in with a username and a password. The first time, a person types their username and
// chooses their own password (Aaron, 2026-11-26).
import { useState } from "react";
import { api, ApiError } from "../api";
import { ErrorNote } from "../components/ui";
import { LANGS, setLang, t, useLang } from "../i18n";

export function SignIn({ onDone }: { onDone: () => void }) {
  const lang = useLang();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [first, setFirst] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (first && password !== again) return setError(t("The two passwords don't match."));
    setBusy(true);
    try {
      await api(first ? "/auth/password/first" : "/auth/login", { body: { login: login.trim(), password } });
      onDone();
    } catch (x) {
      const err = x as ApiError & { firstTime?: boolean };
      if (!first && err.firstTime) {
        // Their first sign-in: show the boxes to choose a password.
        setFirst(true);
        setPassword("");
        setAgain("");
      } else setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center">
      <form className="panel signin" onSubmit={submit}>
        <img src={logoUrl} alt="Ronchi" />
        <div>
          <h1>Ronchi Portal</h1>
          <p className="sub">{first ? t("This is your first sign-in. Choose a password of at least 8 characters. You'll use it from now on.") : t("Staff sign-in.")}</p>
        </div>
        <div className="field">
          <label htmlFor="si-user">{t("Username")}</label>
          <input id="si-user" name="username" type="text" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={login} onChange={(e) => { setLogin(e.target.value); if (first) setFirst(false); }} required autoFocus />
        </div>
        <div className="field">
          <label htmlFor="si-pass">{first ? t("New password") : t("Password")}</label>
          <input id="si-pass" name="password" type="password" autoComplete={first ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} minLength={first ? 8 : undefined} maxLength={200} required={first} />
        </div>
        {first && (
          <div className="field">
            <label htmlFor="si-again">{t("New password again")}</label>
            <input id="si-again" name="password-again" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} maxLength={200} required />
          </div>
        )}
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? t("Signing in…") : first ? t("Save password and sign in") : t("Sign in")}
        </button>
        <ErrorNote error={error} />
        <p className="muted">{first ? t("Not your first time? Type your username again to go back.") : t("First time here? Type your username and press Sign in. You'll choose your password next. Forgot your password? Ask your admin to reset it.")}</p>
        <div className="row langrow" role="radiogroup" aria-label={t("Language")}>
          {LANGS.map((l) => <button key={l.id} type="button" className={`linkish${lang === l.id ? " on" : ""}`} role="radio" aria-checked={lang === l.id} onClick={() => setLang(l.id)}>{l.name}</button>)}
        </div>
      </form>
    </div>
  );
}
