// The manual's drawing shown in the 3D view, for an assembly nobody has a CAD model of yet.
// The sheet lies in space: drag to tilt and turn it, scroll or pinch to zoom, and every balloon
// stands up off the paper and can be clicked, the same as a part in a real 3D model. It is one
// flat drawing, not a solid model; the note under it says so. When a CAD file is loaded for the
// assembly, the real 3D takes this view's place.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { IC, Ib } from "./icons";
import type { Balloon } from "./Drawing2D";
import { w, type Lang } from "./words";

const START = { rx: 52, rz: -16, s: 1, x: 0, y: 0 };
const MIN = 0.3;
const MAX = 10;

export function DrawingTilt({
  src, width, height, balloons, selected, onPick, lang, lead, label,
}: {
  src: string;
  width: number;
  height: number;
  balloons: Balloon[];
  selected: string | null;   // the selected row's position
  onPick: (pos: string) => void;
  lang: Lang;
  lead?: ReactNode;    // buttons at the start of the toolbar (the Drawing / 3D switch)
  label?: string;      // shown at the end of the toolbar
}) {
  const box = useRef<HTMLDivElement>(null);
  const [view, setView] = useState(START);
  const [base, setBase] = useState(0.2);   // the scale at which the whole sheet fits the box
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [full, setFull] = useState(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ x: number; y: number; from: typeof START; dist: number; pan: boolean } | null>(null);

  const measure = useCallback(() => {
    const el = box.current;
    if (el) setBase(Math.min(el.clientWidth / width, el.clientHeight / height) * 0.9);
  }, [width, height]);

  useEffect(() => {
    measure();
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, full]);

  const zoom = (factor: number) => setView((v) => ({ ...v, s: Math.min(MAX, Math.max(MIN, v.s * factor)) }));

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => { e.preventDefault(); zoom(Math.exp(-e.deltaY * 0.0015)); };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  function down(e: React.PointerEvent) {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    drag.current = {
      x: e.clientX, y: e.clientY, from: view,
      dist: pts.length === 2 ? Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y) : 0,
      pan: e.shiftKey || e.button === 2 || e.button === 1 || pts.length === 2,
    };
  }
  function move(e: React.PointerEvent) {
    const d = drag.current;
    if (!pointers.current.has(e.pointerId) || !d) return;
    const before = pointers.current.get(e.pointerId)!;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    if (pts.length === 2) {
      // Two fingers: pinch to zoom, and the pair moves the sheet.
      const dist = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
      if (d.dist) zoom(dist / d.dist);
      d.dist = dist;
      setView((v) => ({ ...v, x: v.x + (e.clientX - before.x) / 2, y: v.y + (e.clientY - before.y) / 2 }));
      return;
    }
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (d.pan) setView((v) => ({ ...v, x: d.from.x + dx, y: d.from.y + dy }));
    else setView((v) => ({ ...v, rz: d.from.rz + dx * 0.4, rx: Math.min(82, Math.max(0, d.from.rx - dy * 0.4)) }));
  }
  function up(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    drag.current = null;
  }

  const s = base * view.s;
  // Balloons stand a fixed distance off the paper on screen, whatever the zoom.
  const lift = 14 / s;

  return (
    <div className={`cv-stage${full ? " cv-full" : ""}`}>
      <div className="cv-tools" role="toolbar" aria-label={w(lang, "3D")}>
        {lead}
        <Ib icon={IC.home} label={w(lang, "Fit")} onClick={() => setView(START)} />
        <Ib icon={IC.drawing} label={w(lang, "Look straight down")} pressed={view.rx === 0 && view.rz === 0} onClick={() => setView((v) => ({ ...v, rx: 0, rz: 0 }))} />
        <Ib icon={IC.zoomIn} label={w(lang, "Zoom in")} onClick={() => zoom(1.4)} />
        <Ib icon={IC.zoomOut} label={w(lang, "Zoom out")} onClick={() => zoom(1 / 1.4)} />
        <Ib icon={full ? IC.unfull : IC.full} label={w(lang, full ? "Exit full screen" : "Full screen")} pressed={full} onClick={() => setFull(!full)} />
        <span className="cv-gap" />
        {label && <span className="cv-label">{label}</span>}
      </div>
      <div
        ref={box}
        className="cv-canvas cv-3d cv-tilt"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onContextMenu={(e) => e.preventDefault()}
        onDoubleClick={() => zoom(1.6)}
      >
        <div
          className="cv-tilt-sheet"
          style={{
            width, height, marginLeft: -width / 2, marginTop: -height / 2,
            transform: `translate(${view.x}px, ${view.y}px) scale3d(${s}, ${s}, ${s}) rotateX(${view.rx}deg) rotateZ(${view.rz}deg)`,
          }}
        >
          <div className="cv-tilt-slab" style={{ transform: `translateZ(${-10 / s}px)` }} />
          <img src={src} width={width} height={height} alt="" draggable={false} onLoad={() => setState("ready")} onError={() => setState("error")} />
          {state === "ready" &&
            balloons.map((b, i) => (
              <button
                key={`${b.pos}-${i}`}
                type="button"
                className={`cv-pin${b.pos === selected ? " on" : ""}`}
                style={{
                  left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%`,
                  transform: `translateZ(${b.pos === selected ? lift * 2.5 : lift}px)`,
                }}
                aria-label={`${w(lang, "Pos.")} ${b.pos}`}
                aria-pressed={b.pos === selected}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => onPick(b.pos)}
              />
            ))}
        </div>
        {state === "loading" && <p className="cv-msg">{w(lang, "Loading the drawing…")}</p>}
        {state === "error" && <p className="cv-msg">{w(lang, "The drawing couldn't be loaded.")}</p>}
        <p className="cv-tilt-note">{w(lang, "Manual drawing shown in 3D. There is no CAD model for this assembly yet.")}</p>
      </div>
      <p className="cv-hint">{w(lang, "Drag to tilt and turn. Shift-drag, right-drag or two fingers to move. Scroll or pinch to zoom. Click a number to find its part.")}</p>
    </div>
  );
}
