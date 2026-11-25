import { useEffect, useState, type ReactNode } from "react";
import { t } from "../i18n";
import { hrefFor, navigate } from "../router";
import { hideTip, useTipHidden } from "../tips";

export function Link({ to, children, className, current }: { to: string; children: ReactNode; className?: string; current?: boolean }) {
  return (
    <a
      href={hrefFor(to)}
      className={className}
      aria-current={current ? "page" : undefined}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}

/** `tip` names the subtitle when it's an instruction a person can close with the ×. Subtitles that
 * show the record's own details (a machine's model, a quote's company) leave `tip` out. */
export function PageHead({ title, sub, tip, children }: { title: string; sub?: string; tip?: string; children?: ReactNode }) {
  return (
    <div className="row pagehead">
      <div>
        <h1>{title}</h1>
        {sub && (tip ? <Tip id={tip} className="sub">{sub}</Tip> : <p className="sub">{sub}</p>)}
      </div>
      <span className="spacer" />
      {children}
    </div>
  );
}

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return <p className="err" role="alert">{t(error)}</p>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

/** Load data from the API, with loading and error states. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[] = []): { data: T | null; error: string | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setError(null);
    load().then((d) => live && setData(d), (e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, error, reload: () => setTick((t) => t + 1) };
}

let toastTimer: number | undefined;
export function toast(message: string) {
  let el = document.querySelector<HTMLDivElement>(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    el.setAttribute("role", "status");
    document.body.appendChild(el);
  }
  el.textContent = t(message);
  el.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el && (el.hidden = true), 3500);
}

/** An instruction note with a small × to close it after reading. Closed notes stay closed on every
 * device for that person until they press Show tips again in Settings. Don't use it for warnings
 * (customer names, links anyone can use): those must always show. */
export function Tip({ id, children, className = "muted", as = "p" }: { id: string; children: ReactNode; className?: string; as?: "p" | "span" }) {
  const hidden = useTipHidden(id);
  if (hidden) return null;
  const Tag = as;
  return (
    <Tag className={`tip ${className}`} data-tip={id}>
      <span className="tip-text">{children}</span>
      <button type="button" className="tip-x" aria-label={t("Hide this tip")} title={t("Hide this tip")} onClick={() => hideTip(id)}>
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
      </button>
    </Tag>
  );
}
