// Small line icons drawn for the portal (24px grid, 1.8 stroke), so the app needs no icon font.
const P = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;

function Svg({ size = 20, children }: { size?: number; children: React.ReactNode }) {
  return <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">{children}</svg>;
}

export const Dots = ({ size }: { size?: number }) => <Svg size={size}><circle cx="12" cy="5.5" r="1.6" fill="currentColor" /><circle cx="12" cy="12" r="1.6" fill="currentColor" /><circle cx="12" cy="18.5" r="1.6" fill="currentColor" /></Svg>;
export const Clip = ({ size }: { size?: number }) => <Svg size={size}><path {...P} d="m20.5 11.5-8.3 8.3a5 5 0 0 1-7.1-7.1l8.6-8.6a3.4 3.4 0 0 1 4.8 4.8l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l7.9-7.9" /></Svg>;
export const Camera = ({ size }: { size?: number }) => <Svg size={size}><path {...P} d="M4 8h3l1.6-2.4h6.8L17 8h3v11H4z" /><circle {...P} cx="12" cy="13" r="3.6" /></Svg>;
export const Search = ({ size }: { size?: number }) => <Svg size={size}><circle {...P} cx="10.5" cy="10.5" r="6" /><path {...P} d="m15 15 5 5" /></Svg>;
export const BellOff = ({ size = 14 }: { size?: number }) => <Svg size={size}><path {...P} d="M9.5 19a2.5 2.5 0 0 0 5 0M6 16h12l-1.6-2.2V10a4.4 4.4 0 0 0-7.6-3M6.5 10v3.8L6 16M3.5 3.5l17 17" /></Svg>;
export const Download = ({ size }: { size?: number }) => <Svg size={size}><path {...P} d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19.5h14" /></Svg>;
export const Close = ({ size }: { size?: number }) => <Svg size={size}><path {...P} d="m6 6 12 12M18 6 6 18" /></Svg>;
export const Check = ({ size = 16 }: { size?: number }) => <Svg size={size}><path {...P} d="m5 12.5 4.5 4.5L19 7.5" /></Svg>;
export const Chevron = ({ size = 14 }: { size?: number }) => <Svg size={size}><path {...P} d="m6.5 9.5 5.5 5.5 5.5-5.5" /></Svg>;
export const Send = ({ size = 20 }: { size?: number }) => <Svg size={size}><path d="M3.4 20.4 21 12 3.4 3.6 3.3 10l12.6 2-12.6 2z" fill="currentColor" /></Svg>;
export const Pencil = ({ size = 16 }: { size?: number }) => <Svg size={size}><path {...P} d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" /></Svg>;

/** A file badge: a page with the file's type written on it, like a desktop file icon. */
export function FileBadge({ ext, kind }: { ext: string; kind: string }) {
  return <span className={`filebadge fk-${kind}`} aria-hidden="true">{ext.slice(0, 4).toUpperCase()}</span>;
}
