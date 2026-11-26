import logoUrl from "../assets/ronchi-logo.png";
// Username and password. The first time someone signs in, they make their own password here.
import { useState } from "react";
import { api } from "../api";
import { ErrorNote } from "../components/ui";
import { LANGS, setLang, t, useLang } from "../i18n";

export function SignIn({ onDone }: { onDone: () => void }) {
  const lang = useLang();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  // Set when the login has no password yet: the person makes one now.
  const [first, setFirst] = useState<{ name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (first) {
        if (password !== again) throw new Error(t("The two passwords don't match."));
        await api("/auth/password/first", { body: { login, password } });
        onDone();
        return;
      }
      const r = await api("/auth/password/login", { body: { login, password } });
      if (r.firstTime) {
        setFirst({ name: r.name });
        setPassword("");
        setAgain("");
        return;
      }
      onDone();
    } catch (x) {
      setError((x as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center">
      <form className="panel signin" onSubmit={submit}>
        <img src={logoUrl} alt="Ronchi" />
        <div>
          <h1>{first ? t("Welcome, {name}", { name: first.name.split(" ")[0]! }) : "Ronchi Portal"}</h1>
          <p className="sub">{first ? t("This is your first sign-in. Make your own password: at least 8 characters.") : t("Staff sign-in.")}</p>
        </div>
        <div className="field">
          <label htmlFor="si-login">{t("Username")}</label>
          <input id="si-login" name="username" type="text" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false}
            value={login} onChange={(e) => { setLogin(e.target.value); setFirst(null); }} required maxLength={200} autoFocus />
        </div>
        <div className="field">
          <label htmlFor="si-pass">{first ? t("New password") : t("Password")}</label>
          <input id="si-pass" name="password" type="password" autoComplete={first ? "new-password" : "current-password"}
            value={password} onChange={(e) => setPassword(e.target.value)} required={!!first} minLength={first ? 8 : undefined} maxLength={200} />
        </div>
        {first && (
          <div className="field">
            <label htmlFor="si-again">{t("Type it again")}</label>
            <input id="si-again" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required minLength={8} maxLength={200} />
          </div>
        )}
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? t("Signing in…") : first ? t("Save password and sign in") : t("Sign in")}
        </button>
        <ErrorNote error={error} />
        <p className="muted">{t("New here, or forgot your password? Ask your admin.")}</p>
        <div className="row langrow" role="radiogroup" aria-label={t("Language")}>
          {LANGS.map((l) => <button key={l.id} type="button" className={`linkish${lang === l.id ? " on" : ""}`} role="radio" aria-checked={lang === l.id} onClick={() => setLang(l.id)}>{l.name}</button>)}
        </div>
      </form>
    </div>
  );
}
