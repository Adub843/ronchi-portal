import { useState } from "react";
import { startAuthentication } from "@simplewebauthn/browser";
import { api } from "../api";
import { ErrorNote } from "../components/ui";

export function SignIn({ onDone }: { onDone: () => void }) {
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
      setError(err.name === "NotAllowedError" ? "Sign-in was cancelled." : err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center">
      <div className="panel signin">
        <img src="/ronchi-logo.png" alt="Ronchi" />
        <div>
          <h1>Ronchi Portal</h1>
          <p className="sub">Staff sign-in. Use Face ID, your fingerprint, Windows Hello or your device PIN.</p>
        </div>
        <button className="btn primary" onClick={signIn} disabled={busy}>
          {busy ? "Waiting for your passkey…" : "Sign in with passkey"}
        </button>
        <ErrorNote error={error} />
        <p className="muted">New here, or on a new phone? Ask Paolo for an invite link.</p>
      </div>
    </div>
  );
}
