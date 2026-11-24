// The exploded drawing from the manual, with every balloon number clickable.
// Drag to move, wheel or pinch to zoom. Clicking a balloon selects that row in the parts list;
// selecting a row lights up its balloons and brings them into view.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Hotspot } from "../../src/shared/catalog/model";
import { w, type Lang } from "./words";

export interface Balloon extends Hotspot {
  pos: string;
}

const MIN = 0.1;
const MAX = 12;

export function Drawing2D({
  src, width, height, balloons, selected, onPick, lang, onPlace,
}: {
  src: string;
  width: number;
  height: number;
  balloons: Balloon[];
  selected: string | null;   // the selected row's position
  onPick: (pos: string) => void;
  lang: Lang;
  /** Staff only: a click on the drawing (not on a balloon) adds a balloon here. Fractions of the image. */
  onPlace?: (x: number, y: number) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ s: 1, x: 0, y: 0 });
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [full, setFull] = useState(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; dist: number; moved: boolean } | null>(null);

  const fit = useCallback(() => {
    const el = box.current;
    if (!el) return;
    const s = Math.min(el.clientWidth / width, el.clientHeight / height) * 0.98;
    setView({ s, x: (el.clientWidth - width * s) / 2, y: (el.clientHeight - height * s) / 2 });
  }, [width, height]);

  useEffect(() => {
    fit();
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => fit());
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit, full]);

  // Zoom keeping the point under (cx, cy) still.
  const zoomAt = (factor: number, cx: number, cy: number) =>
    setView((v) => {
      const s = Math.min(MAX, Math.max(MIN, v.s * factor));
      const k = s / v.s;
      return { s, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
    });

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Bring the selected balloon into view when it's off screen.
  useEffect(() => {
    const el = box.current;
    const b = balloons.find((x) => x.pos === selected);
    if (!el || !b) return;
    setView((v) => {
      const bx = v.x + (b.x + b.w / 2) * width * v.s;
      const by = v.y + (b.y + b.h / 2) * height * v.s;
      const margin = 40;
      if (bx > margin && by > margin && bx < el.clientWidth - margin && by < el.clientHeight - margin) return v;
      return { ...v, x: v.x + el.clientWidth / 2 - bx, y: v.y + el.clientHeight / 2 - by };
    });
  }, [selected, balloons, width, height]);

  function down(e: React.PointerEvent) {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, dist: pts.length === 2 ? Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y) : 0, moved: false };
  }
  function move(e: React.PointerEvent) {
    if (!pointers.current.has(e.pointerId) || !drag.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    const r = box.current!.getBoundingClientRect();
    if (pts.length === 2) {
      const d = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
      if (drag.current.dist) zoomAt(d / drag.current.dist, (pts[0]!.x + pts[1]!.x) / 2 - r.left, (pts[0]!.y + pts[1]!.y) / 2 - r.top);
      drag.current.dist = d;
      drag.current.moved = true;
      return;
    }
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.current.moved = true;
    const { vx, vy } = drag.current;
    setView((v) => ({ ...v, x: vx + dx, y: vy + dy }));
  }
  function up(e: React.PointerEvent) {
    if (onPlace && pointers.current.size === 1 && drag.current && !drag.current.moved) {
      const r = box.current!.getBoundingClientRect();
      const x = (e.clientX - r.left - view.x) / (width * view.s);
      const y = (e.clientY - r.top - view.y) / (height * view.s);
      if (x >= 0 && x <= 1 && y >= 0 && y <= 1) onPlace(x, y);
    }
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) setTimeout(() => (drag.current = null), 0);
    else {
      const p = [...pointers.current.values()][0]!;
      drag.current = { x: p.x, y: p.y, vx: view.x, vy: view.y, dist: 0, moved: true };
    }
  }

  const centre = () => {
    const el = box.current!;
    return [el.clientWidth / 2, el.clientHeight / 2] as const;
  };

  return (
    <div className={`cv-stage${full ? " cv-full" : ""}`}>
      <div className="cv-tools" role="toolbar" aria-label={w(lang, "Drawing")}>
        <button type="button" className="cv-btn" onClick={() => zoomAt(1.4, ...centre())} aria-label={w(lang, "Zoom in")} title={w(lang, "Zoom in")}>+</button>
        <button type="button" className="cv-btn" onClick={() => zoomAt(1 / 1.4, ...centre())} aria-label={w(lang, "Zoom out")} title={w(lang, "Zoom out")}>−</button>
        <button type="button" className="cv-btn" onClick={fit}>{w(lang, "Fit")}</button>
        <span className="cv-gap" />
        <button type="button" className="cv-btn" onClick={() => setFull(!full)} aria-pressed={full}>{w(lang, full ? "Exit full screen" : "Full screen")}</button>
      </div>
      <div
        ref={box}
        className={`cv-canvas cv-2d${onPlace ? " cv-placing" : ""}`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onDoubleClick={(e) => {
          const r = box.current!.getBoundingClientRect();
          zoomAt(2, e.clientX - r.left, e.clientY - r.top);
        }}
      >
        <div className="cv-paper" style={{ width, height, transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})` }}>
          <img src={src} width={width} height={height} alt="" draggable={false} onLoad={() => setState("ready")} onError={() => setState("error")} />
          {state === "ready" &&
            balloons.map((b, i) => (
              <button
                key={`${b.pos}-${i}`}
                type="button"
                className={`cv-spot${b.pos === selected ? " on" : ""}`}
                style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` }}
                aria-label={`${w(lang, "Pos.")} ${b.pos}`}
                aria-pressed={b.pos === selected}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => onPick(b.pos)}
              />
            ))}
        </div>
        {state === "loading" && <p className="cv-msg">{w(lang, "Loading the drawing…")}</p>}
        {state === "error" && <p className="cv-msg">{w(lang, "The drawing couldn't be loaded.")}</p>}
      </div>
      <p className="cv-hint">{w(lang, "Drag to move. Scroll or pinch to zoom. Click a number to find its part.")}</p>
    </div>
  );
}
