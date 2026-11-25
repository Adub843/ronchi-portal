// A parts list's 3D views (iso, front, top, right), rendered in Fusion from the CAD assembly.
// Shown in the viewer when the parts list has them: on its own tab next to the drawing and 3D,
// or alone when there is nothing else. Used by the staff catalog and the customer parts site.
import { useState, type ReactNode } from "react";
import { w, type Lang, type Word } from "./words";

const NAME: Record<string, Word> = { iso: "Iso view", front: "Front view", top: "Top view", right: "Right view" };

export function ViewPictures({ views, src, lang, lead, label, alt }: {
  views: string[];
  src: (view: string) => string;
  lang: Lang;
  lead?: ReactNode;
  label?: string;
  alt: string;
}) {
  const [view, setView] = useState(views[0] ?? "iso");
  const [broken, setBroken] = useState<string | null>(null);
  return (
    <div className="cv-stage">
      <div className="cv-tools" role="toolbar" aria-label={w(lang, "Pictures")}>
        {lead}
        {views.map((v) => (
          <button key={v} type="button" className="cv-btn" aria-pressed={v === view} onClick={() => setView(v)}>{w(lang, NAME[v] ?? "Iso view")}</button>
        ))}
        <span className="cv-gap" />
        {label && <span className="cv-label">{label}</span>}
      </div>
      <div className="cv-canvas cv-pics">
        {broken === view ? <p className="cv-msg">{w(lang, "The picture couldn't be loaded.")}</p>
          : <img src={src(view)} alt={`${alt} - ${w(lang, NAME[view] ?? "Iso view")}`} onError={() => setBroken(view)} />}
      </div>
    </div>
  );
}
