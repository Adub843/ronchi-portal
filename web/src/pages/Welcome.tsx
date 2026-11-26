import logoUrl from "../assets/ronchi-logo.png";
// Opened from an older invite link: /welcome#<token>. The person makes their password and is signed in.
import { useEffect, useState } from "react";
import { api } from "../api";
import { ErrorNote } from "../components/ui";
import { t } from "../i18n";
import { navigate } from "../router";

export function Welcome({ onDone }: { onDone: () => void }) {
  const [token] = useState(() => location.hash.slice(1));
  const [invite, setInvite] = useState<{ name: string; email: string; addingDevice: boolean } | null>(null);
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Take the token out of the address bar straight away.
    history.replaceState(null, "", "/welcome");
    if (!token) return setError(t("This invite link isn't complete. Open it again from the message you were sent."));
    api("/auth/invite/check", { body: { token } }).then(setInvite, (e: Error) => setError(e.message));
  }, [token]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (password !== again) throw new Error(t("The two passwords don't match."));
      await api("/auth/invite/password", { body: { token, password } });
      navigate("/");
      onDone();
    } catch (x) {
      setError((x as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center">
      <form className="panel signin" onSubmit={create}>
        <img src={logoUrl} alt="Ronchi" />
        {invite ? (
          <>
            <div>
              <h1>{t("Welcome, {name}", { name: invite.name.split(" ")[0]! })}</h1>
              <p className="sub">{t("Your username is {email}. Make your own password: at least 8 characters.", { email: invite.email })}</p>
            </div>
            <input type="text" name="username" autoComplete="username" value={invite.email} readOnly hidden />
            <div className="field">
              <label htmlFor="wl-pass">{t("New password")}</label>
              <input id="wl-pass" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} maxLength={200} autoFocus />
            </div>
            <div className="field">
              <label htmlFor="wl-again">{t("Type it again")}</label>
              <input id="wl-again" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required minLength={8} maxLength={200} />
            </div>
            <button className="btn primary" type="submit" disabled={busy}>{busy ? t("Signing in…") : t("Save password and sign in")}</button>
          </>
        ) : (
          !error && <p className="muted">{t("Checking your invite…")}</p>
        )}
        <ErrorNote error={error} />
      </form>
    </div>
  );
}
