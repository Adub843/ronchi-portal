// Line icons for the catalog: big ones for the tiles (like the Ronchi Mario portal's), small ones
// for the viewer toolbar and the parts list. Drawn here, in our own style; all use currentColor.
import type { ReactNode } from "react";

const svg = (size: number, body: ReactNode, stroke = 1.6) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{body}</svg>
);

const gear = (cx: number, cy: number, r: number) => {
  const teeth = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4;
    return `M${cx + Math.cos(a) * r} ${cy + Math.sin(a) * r}L${cx + Math.cos(a) * (r + 1.6)} ${cy + Math.sin(a) * (r + 1.6)}`;
  }).join("");
  return <><circle cx={cx} cy={cy} r={r} /><circle cx={cx} cy={cy} r={r * 0.4} /><path d={teeth} /></>;
};

/** Big tile pictures. */
export const TILE = {
  catalogue: svg(64, <><rect x="3" y="3" width="11" height="16" rx="1" /><path d="M6 7h5M6 10h5M6 13h3" />{gear(17, 16, 3.2)}</>, 1.1),
  machine: svg(64, <><rect x="2.5" y="9" width="8" height="7" rx="1.5" /><path d="M10.5 11h2v3h-2M4.5 9v7M1.5 12.5h1M14 9.5h7.5M14 12.5h7.5M14 15.5h7.5" /></>, 1.1),
  format: svg(64, <>{gear(7, 12, 3.4)}<path d="M14 8.5h7.5M14 12h7.5M14 15.5h7.5" /></>, 1.1),
  elevator: svg(64, <><path d="M3 20h18M5 20V8l7-4 7 4v12M9 20v-6h6v6M9 10h6" /></>, 1.1),
  kit: svg(64, <><path d="M3 8l9-4 9 4v9l-9 4-9-4z" /><path d="M3 8l9 4 9-4M12 12v9" /></>, 1.1),
  partsList: svg(64, <><rect x="4" y="3" width="11" height="15" rx="1" /><path d="M6.5 7h6M6.5 9.5h6M6.5 12h6M6.5 14.5h4" />{gear(17.5, 17, 2.8)}</>, 1.1),
  spares: svg(64, <><path d="M14.5 6.5a4 4 0 0 0-5.3 5.1L3.5 17.3a1.6 1.6 0 0 0 2.3 2.3l5.7-5.7a4 4 0 0 0 5.1-5.3l-2.4 2.4-2.2-.4-.4-2.2z" /><path d="M16 15l4 4M18.5 13.5l2.5 2.5" /></>, 1.1),
  book: svg(64, <><path d="M4 4.5h6.5a2 2 0 0 1 2 2V20a1.5 1.5 0 0 0-1.5-1.5H4zM20 4.5h-6.5a2 2 0 0 0-2 2V20a1.5 1.5 0 0 1 1.5-1.5H20z" /><path d="M6.5 8.5h3.5M6.5 11h3.5M14 8.5h3.5M14 11h3.5" /></>, 1.1),
  filler: svg(64, <><rect x="3" y="13" width="18" height="6" rx="1" /><path d="M6 13V8h12v5M9 8V5h6v3M12 5V3M5 19v2M19 19v2M8 16h2M12 16h2" /></>, 1.1),
  folder: svg(64, <><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" /></>, 1.1),
  docs: svg(64, <><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v4h4M9.5 11h6M9.5 14h6M9.5 17h4" /></>, 1.1),
};

/** Small icons for toolbars and lists. */
export const IC = {
  home: svg(18, <><path d="M3.5 11L12 4l8.5 7M6 9.5V20h4.5v-5h3v5H18V9.5" /></>),
  zoomAll: svg(18, <><rect x="4" y="4" width="16" height="16" rx="1" /><path d="M8 8h3M8 8v3M16 16h-3M16 16v-3" /></>),
  zoomWindow: svg(18, <><path d="M3 9V3h6M21 9V3h-6M3 15v6h6" strokeDasharray="2 2" /><circle cx="15" cy="15" r="3.5" /><path d="M17.5 17.5L21 21" /></>),
  zoomIn: svg(18, <><circle cx="10.5" cy="10.5" r="6" /><path d="M15 15l5.5 5.5M8 10.5h5M10.5 8v5" /></>),
  zoomOut: svg(18, <><circle cx="10.5" cy="10.5" r="6" /><path d="M15 15l5.5 5.5M8 10.5h5" /></>),
  zoomSelected: svg(18, <><circle cx="10.5" cy="10.5" r="6" /><path d="M15 15l5.5 5.5" /><rect x="8" y="8" width="5" height="5" fill="currentColor" stroke="none" /></>),
  isolate: svg(18, <><rect x="3.5" y="3.5" width="17" height="17" rx="1" strokeDasharray="2 2" /><rect x="8.5" y="8.5" width="7" height="7" fill="currentColor" stroke="none" /></>),
  hide: svg(18, <><path d="M3 12s3.3-6 9-6 9 6 9 6-3.3 6-9 6-9-6-9-6z" /><circle cx="12" cy="12" r="2.5" /><path d="M4 20L20 4" /></>),
  showAll: svg(18, <><path d="M3 12s3.3-6 9-6 9 6 9 6-3.3 6-9 6-9-6-9-6z" /><circle cx="12" cy="12" r="2.5" /></>),
  move: svg(18, <><path d="M12 3v18M3 12h18M12 3l-2.5 2.5M12 3l2.5 2.5M12 21l-2.5-2.5M12 21l2.5-2.5M3 12l2.5-2.5M3 12l2.5 2.5M21 12l-2.5-2.5M21 12l-2.5 2.5" /></>),
  restoreAll: svg(18, <><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4" /></>),
  restorePart: svg(18, <><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4" /><rect x="10" y="10" width="4" height="4" fill="currentColor" stroke="none" /></>),
  orient: svg(18, <><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" /><path d="M4 7.5l8 4.5 8-4.5M12 12v9" /></>),
  xray: svg(18, <><rect x="4" y="4" width="11" height="11" rx="1" /><rect x="9" y="9" width="11" height="11" rx="1" strokeDasharray="2 2" /></>),
  explode: svg(18, <><rect x="9" y="9" width="6" height="6" /><path d="M7 7L3.5 3.5M17 7l3.5-3.5M7 17l-3.5 3.5M17 17l3.5 3.5" /></>),
  section: svg(18, <><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" /><path d="M2.5 13.5l19-4" strokeDasharray="2 2" /></>),
  tree: svg(18, <><path d="M5 4v14h5M5 9h5M5 14h5" /><rect x="10" y="7" width="9" height="4" rx="1" /><rect x="10" y="12" width="9" height="4" rx="1" /><rect x="10" y="17" width="9" height="3" rx="1" /></>),
  camera: svg(18, <><path d="M4 8h3l1.5-2.5h7L17 8h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></>),
  full: svg(18, <><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></>),
  unfull: svg(18, <><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /></>),
  views: svg(18, <><circle cx="12" cy="12" r="8.5" /><path d="M12 3.5v17M3.5 12h17" /></>),
  drawing: svg(18, <><rect x="3.5" y="4" width="17" height="16" rx="1" /><path d="M3.5 16h17M15 16v4M7 8l4 4 3-2 3 3" /></>),
  model: svg(18, <><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" /><path d="M4 7.5l8 4.5 8-4.5M12 12v9" /></>),
  prev: svg(18, <path d="M15 5l-7 7 7 7" />, 2),
  next: svg(18, <path d="M9 5l7 7-7 7" />, 2),
  info: svg(16, <><circle cx="12" cy="12" r="9" fill="currentColor" stroke="none" /><path d="M12 11v6M12 7.5v.5" stroke="#fff" strokeWidth={2.2} /></>),
  cart: svg(16, <><path d="M3 4h2.5l2 11h10.5l2-8H6.5" /><circle cx="9" cy="19" r="1.4" /><circle cx="17" cy="19" r="1.4" /></>, 1.9),
  star: svg(20, <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9l-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z" />),
  starOn: svg(20, <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9l-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z" fill="currentColor" />),
  list: svg(18, <><rect x="3.5" y="4" width="7" height="16" rx="1" /><path d="M13.5 6h7M13.5 10h7M13.5 14h7M13.5 18h5" /></>),
  bookmarks: svg(20, <><rect x="4" y="3.5" width="12" height="16" rx="1" /><path d="M7 7.5h6M7 10.5h6M7 13.5h3" /><path d="M17.5 13l1.2 2.4 2.6.4-1.9 1.8.5 2.6-2.4-1.3-2.3 1.3.4-2.6-1.9-1.8 2.7-.4z" fill="currentColor" /></>),
  menu: svg(20, <path d="M4 6.5h16M4 12h16M4 17.5h16" />, 2.2),
  gearPart: svg(30, <>{gear(12, 12, 5.5)}</>, 1),
  search: svg(16, <><circle cx="10.5" cy="10.5" r="6" /><path d="M15 15l5 5" /></>),
  caret: svg(12, <path d="M6 9l6 6 6-6" />, 2.4),
  close: svg(16, <path d="M6 6l12 12M18 6L6 18" />, 2),
  language: svg(20, <><path d="M3 5h9M7.5 3v2M5 5c.5 3 2.5 5.5 5.5 7M10 5c-.6 3.4-3 6.5-6.5 8" /><path d="M12.5 21l3.8-9 3.7 9M13.8 18h5" /></>),
};

/** A toolbar button that shows an icon, with its name as the tooltip and for screen readers. */
export function Ib({ icon, label, onClick, pressed, disabled }: { icon: ReactNode; label: string; onClick: () => void; pressed?: boolean; disabled?: boolean }) {
  return (
    <button type="button" className="cv-ib" title={label} aria-label={label} aria-pressed={pressed} disabled={disabled} onClick={onClick}>{icon}</button>
  );
}
