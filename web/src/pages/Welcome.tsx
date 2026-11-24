import logoUrl from "../assets/ronchi-logo.png";
// Opened from an invite link: /welcome#<token>. Creates the person's passkey.
import { useEffect, useState } from "react";
import { startRegistration } from "@simplewebauthn/browser";
import { api } from "../api";
import { ErrorNote } from "../components/ui";
import { t } from "../i18n";
import { navigate } from "../router";

export function Welcome({ onDone }: { onDone: () => void }) {
  const [token] = useState(() => location.hash.slice(1));
  const [invite, setInvite] = useState<{ name: string; email: string; addingDevice: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Take the token out of the address bar straight away.
    history.replaceState(null, "", "/welcome");
    if (!token) return setError(t("This invite link isn't complete. Open it again from the message you were sent."));
    api("/auth/invite/check", { body: { token } }).then(setInvite, (e: Error) => setError(e.message));
  }, [token]);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const { challengeId, userId, options } = await api("/auth/register/options", { body: { token } });
      const response = await startRegistration({ optionsJSON: options });
      await api("/auth/register/verify", { body: { token, challengeId, userId, response, nickname: navigator.platform || null } });
      navigate("/");
      onDone();
    } catch (e) {
      const err = e as Error;
      setError(err.name === "NotAllowedError" ? t("Passkey creation was cancelled. Try again.") : err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center">
      <div className="panel signin">
        <img src={logoUrl} alt="Ronchi" />
        {invite ? (
          <>
            <div>
              <h1>{invite.addingDevice ? t("Add this device") : t("Welcome, {name}", { name: invite.name.split(" ")[0]! })}</h1>
              <p className="sub">
                {invite.addingDevice
                  ? t("Create a passkey on this phone or computer so you can sign in here too.")
                  : t("Your Ronchi Portal login is {email}. Create a passkey to finish. Nothing to remember: you'll sign in with Face ID, your fingerprint or your device PIN.", { email: invite.email })}
              </p>
            </div>
            <button className="btn primary" onClick={create} disabled={busy}>
              {busy ? t("Follow the prompt on your device…") : t("Create my passkey")}
            </button>
          </>
        ) : (
          !error && <p className="muted">{t("Checking your invite…")}</p>
        )}
        <ErrorNote error={error} />
      </div>
    </div>
  );
}
