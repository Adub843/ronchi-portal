// The 3D model of an assembly, CAD-style. Everything the Ronchi Mario (InService) viewer does:
// home, zoom to fit, zoom window, zoom in and out, zoom to the selected part, named views
// (Iso 1, Iso 2, front, back, left, right, top, bottom), hide, isolate, show all, move a part
// out of the way and put it back (one or all), and two-way selection with the parts list.
// And more: see-through, explode, section cut, model tree, hover labels, double-click to zoom
// to a part, a part card with quantity, assembly link and "add to cart", saved views, a
// picture of the current view, full screen and keyboard keys. Works with a mouse, a trackpad
// or fingers.
//
// The model is a GLB file. Each part's node name is matched to a Ronchi part code through the
// sheet's mesh map (set by staff), or by the name itself when it starts with a part code (that's
// how SolidWorks and Creo name parts: GF010526, GF010526-1, GF010526_2 ...).
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { IC, Ib } from "./icons";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { codeOf } from "./codes";
import { w, type Lang } from "./words";

interface TreeNode {
  id: string;            // the three.js uuid
  name: string;
  code: string | null;
  depth: number;
  children: TreeNode[];
}

type View = "iso" | "iso2" | "front" | "back" | "left" | "right" | "top" | "bottom";
const VIEWS: Record<View, [number, number, number]> = {
  iso: [1, 0.8, 1], iso2: [-1, 0.8, 1], front: [0, 0, 1], back: [0, 0, -1], left: [-1, 0, 0], right: [1, 0, 0], top: [0, 1, 0.0001], bottom: [0, -1, 0.0001],
};
const VIEW_WORDS: Record<View, "Iso 1" | "Iso 2" | "Front" | "Back" | "Left" | "Right" | "Top" | "Bottom"> = {
  iso: "Iso 1", iso2: "Iso 2", front: "Front", back: "Back", left: "Left", right: "Right", top: "Top", bottom: "Bottom",
};
interface SavedView { name: string; pos: [number, number, number]; target: [number, number, number] }
type Mode = "turn" | "window" | "move";

/** Saved views live in this browser only, per model. Private windows may refuse storage; that's fine. */
function loadViews(key: string): SavedView[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(v) ? v.slice(0, 20) : [];
  } catch {
    return [];
  }
}
function storeViews(key: string, v: SavedView[]) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage turned off: views last until the page closes */
  }
}

export function Model3D({
  src, meshMap, selected, onPick, lang, knownCodes, describe, card, fileName = "model", lead, label,
}: {
  src: string;
  meshMap: Record<string, string>;
  selected: string | null;                 // the selected part code
  onPick: (code: string | null) => void;
  lang: Lang;
  knownCodes: Set<string>;                 // codes in the parts list, to say when a clicked part isn't listed
  describe?: (code: string) => string | null;   // the part's name, for hover labels
  card?: (code: string) => ReactNode;      // the selected part's details and actions (quantity, add to cart ...)
  fileName?: string;                       // for the saved picture
  lead?: ReactNode;                        // buttons at the start of the toolbar (the Drawing / 3D switch)
  label?: string;                          // shown at the end of the toolbar, like Mario's "Sheet:" name
}) {
  const host = useRef<HTMLDivElement>(null);
  const engine = useRef<Engine | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error" | "nogl">("loading");
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [xray, setXray] = useState(false);
  const [explode, setExplode] = useState(0);
  const [section, setSection] = useState<{ axis: "x" | "y" | "z" | null; at: number }>({ axis: null, at: 0.5 });
  const [showTree, setShowTree] = useState(false);
  const [panel, setPanel] = useState<"explode" | "section" | null>(null);
  const [full, setFull] = useState(false);
  const [mode, setMode] = useState<Mode>("turn");
  const [moved, setMoved] = useState(0);   // how many parts have been moved, for the Restore buttons
  const [picked, setPicked] = useState<{ name: string; code: string | null } | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number; code: string | null; name: string } | null>(null);
  const viewKey = `ronchi-views:${src.split("?")[0]}`;
  const [views, setViews] = useState<SavedView[]>(() => loadViews(viewKey));
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const mapRef = useRef(meshMap);
  mapRef.current = meshMap;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let e: Engine;
    try {
      e = new Engine(el, {
        hit: (hit) => {
          setPicked(hit);
          pickRef.current(hit?.code ?? null);
        },
        hover: setHover,
        moved: setMoved,
        windowDone: () => setMode("turn"),
      });
    } catch {
      setState("nogl");
      return;
    }
    engine.current = e;
    setState("loading");
    e.load(src, () => mapRef.current).then(
      (t) => {
        setTree(t);
        setHidden(new Set());
        setState("ready");
      },
      () => setState("error"),
    );
    return () => {
      e.dispose();
      engine.current = null;
    };
  }, [src]);

  useEffect(() => void (engine.current && (engine.current.known = knownCodes)), [knownCodes, state]);
  useEffect(() => {
    engine.current?.setSelected(selected);
    if (!selected) setPicked(null);
    else setPicked((p) => (p?.code === selected ? p : { name: selected, code: selected }));
  }, [selected, state]);
  useEffect(() => engine.current?.setHidden(hidden), [hidden, state]);
  useEffect(() => engine.current?.setXray(xray), [xray, state]);
  useEffect(() => engine.current?.setExplode(explode), [explode, state]);
  useEffect(() => engine.current?.setSection(section.axis, section.at), [section, state]);
  useEffect(() => void (engine.current && (engine.current.mode = mode)), [mode, state]);
  useEffect(() => engine.current?.resize(), [full, showTree]);

  const selectedIds = () => engine.current?.idsFor(selected) ?? [];
  const hide = () => setHidden((h) => new Set([...h, ...selectedIds()]));
  const isolate = () => {
    const keep = new Set(selectedIds());
    if (!keep.size || !engine.current) return;
    setHidden(new Set(engine.current.leafIdsExcept(keep)));
  };
  const showAll = () => setHidden(new Set());
  const home = () => {
    setHidden(new Set());
    setXray(false);
    setExplode(0);
    setSection({ axis: null, at: 0.5 });
    setMode("turn");
    engine.current?.restoreAll();
    engine.current?.view("iso");
  };
  const saveView = () => {
    const v = engine.current?.currentView();
    if (!v) return;
    const next = [...views, { name: w(lang, "My view {n}", { n: views.length + 1 }), ...v }].slice(-20);
    setViews(next);
    storeViews(viewKey, next);
  };
  const picture = () => {
    const url = engine.current?.snapshot();
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileName.replace(/[^A-Za-z0-9_-]+/g, "_")}.png`;
    a.click();
  };

  // Keys work when the viewer has focus (click it first): the same letters CAD tools use.
  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest("input,select,textarea")) return;
    const k = e.key.toLowerCase();
    if (k === "f") engine.current?.fit();
    else if (k === "s" && selected) engine.current?.zoomTo(selected);
    else if (k === "h" && selected) hide();
    else if (k === "i" && selected) isolate();
    else if (k === "a") showAll();
    else if (k === "home") home();
    else if (k === "+" || k === "=") engine.current?.zoom(0.8);
    else if (k === "-") engine.current?.zoom(1.25);
    else if (k === "escape") {
      if (mode !== "turn") setMode("turn");
      else if (full) setFull(false);
      else { setPicked(null); onPick(null); }
    } else return;
    e.preventDefault();
  };

  const hint = mode === "window" ? w(lang, "Drag a box around the area to zoom to.")
    : mode === "move" ? w(lang, "Drag the selected part to move it. Restore puts it back.")
    : w(lang, "Drag to turn. Right-drag or two fingers to move. Scroll or pinch to zoom. Click a part to select it, double-click to zoom to it.");

  return (
    <div className={`cv-stage${full ? " cv-full" : ""}`} onKeyDown={onKey}>
      <div className="cv-tools" role="toolbar" aria-label="3D">
        {lead}
        {/* The same tools, in the same order, as the Ronchi Mario viewer; then ours. */}
        <Ib icon={IC.home} label={w(lang, "Home: starting view, everything shown and in place")} onClick={home} />
        <Ib icon={IC.zoomAll} label={`${w(lang, "Zoom all")} (F)`} onClick={() => engine.current?.fit()} />
        <Ib icon={IC.zoomWindow} label={w(lang, "Zoom window")} pressed={mode === "window"} onClick={() => setMode(mode === "window" ? "turn" : "window")} />
        <Ib icon={IC.zoomIn} label={w(lang, "Zoom in")} onClick={() => engine.current?.zoom(0.8)} />
        <Ib icon={IC.zoomOut} label={w(lang, "Zoom out")} onClick={() => engine.current?.zoom(1.25)} />
        <Ib icon={IC.zoomSelected} label={`${w(lang, "Zoom selected")} (S)`} disabled={!selected} onClick={() => selected && engine.current?.zoomTo(selected)} />
        <Ib icon={IC.isolate} label={`${w(lang, "Isolate")} (I)`} disabled={!selected} onClick={isolate} />
        <Ib icon={IC.hide} label={`${w(lang, "Hide selected")} (H)`} disabled={!selected} onClick={hide} />
        <Ib icon={IC.showAll} label={`${w(lang, "Unhide all")} (A)`} disabled={!hidden.size} onClick={showAll} />
        <Ib icon={IC.move} label={w(lang, "Move part")} pressed={mode === "move"} disabled={!selected && mode !== "move"} onClick={() => setMode(mode === "move" ? "turn" : "move")} />
        <Ib icon={IC.restoreAll} label={w(lang, "Restore all")} disabled={!moved} onClick={() => engine.current?.restoreAll()} />
        <Ib icon={IC.restorePart} label={w(lang, "Restore part")} disabled={!moved || !selected} onClick={() => selected && engine.current?.restore(selected)} />
        <label className="cv-pick" title={w(lang, "Orientation")}>
          {IC.orient}{IC.caret}
          <select aria-label={w(lang, "Orientation")} value="" onChange={(e) => {
            const v = e.target.value;
            if (v === "+save") saveView();
            else if (v.startsWith("my:")) { const sv = views[Number(v.slice(3))]; if (sv) engine.current?.goTo(sv); }
            else if (v.startsWith("del:")) { const next = views.filter((_, i) => i !== Number(v.slice(4))); setViews(next); storeViews(viewKey, next); }
            else if (v) engine.current?.view(v as View);
          }}>
            <option value="">{w(lang, "Orientation")}</option>
            {(Object.keys(VIEWS) as View[]).map((v) => <option key={v} value={v}>{w(lang, VIEW_WORDS[v])}</option>)}
            {views.length > 0 && <optgroup label={w(lang, "My views")}>{views.map((v, i) => <option key={i} value={`my:${i}`}>{v.name}</option>)}</optgroup>}
            <option value="+save">{w(lang, "Save this view")}</option>
            {views.length > 0 && <optgroup label={w(lang, "Remove a view")}>{views.map((v, i) => <option key={i} value={`del:${i}`}>× {v.name}</option>)}</optgroup>}
          </select>
        </label>
        <span className="cv-sep" />
        <Ib icon={IC.xray} label={w(lang, "See-through")} pressed={xray} onClick={() => setXray(!xray)} />
        <Ib icon={IC.explode} label={w(lang, "Explode")} pressed={panel === "explode" || explode > 0} onClick={() => setPanel(panel === "explode" ? null : "explode")} />
        <Ib icon={IC.section} label={w(lang, "Section")} pressed={panel === "section" || !!section.axis} onClick={() => setPanel(panel === "section" ? null : "section")} />
        <Ib icon={IC.tree} label={w(lang, "Model tree")} pressed={showTree} onClick={() => setShowTree(!showTree)} />
        <Ib icon={IC.camera} label={w(lang, "Picture")} onClick={picture} />
        <Ib icon={full ? IC.unfull : IC.full} label={w(lang, full ? "Exit full screen" : "Full screen")} pressed={full} onClick={() => setFull(!full)} />
        <span className="cv-gap" />
        {label && <span className="cv-label">{label}</span>}
      </div>
      {panel === "explode" && (
        <div className="cv-panel">
          <label className="cv-range">{w(lang, "Explode")}<input type="range" min={0} max={1} step={0.01} value={explode} onChange={(e) => setExplode(Number(e.target.value))} /></label>
          <button type="button" className="cv-link" onClick={() => setExplode(0)} disabled={!explode}>{w(lang, "Put back together")}</button>
        </div>
      )}
      {panel === "section" && (
        <div className="cv-panel">
          <label className="cv-select">
            {w(lang, "Section")}
            <select value={section.axis ?? ""} onChange={(e) => setSection({ ...section, axis: (e.target.value || null) as "x" | "y" | "z" | null })}>
              <option value="">{w(lang, "Off")}</option>
              <option value="x">X</option>
              <option value="y">Y</option>
              <option value="z">Z</option>
            </select>
          </label>
          {section.axis && <input className="cv-slim" type="range" min={0} max={1} step={0.005} value={section.at} aria-label={w(lang, "Section")} onChange={(e) => setSection({ ...section, at: Number(e.target.value) })} />}
        </div>
      )}
      <div className="cv-body">
        {showTree && tree && (
          <ModelTree
            tree={tree}
            hidden={hidden}
            selected={selected}
            onToggle={(id) => setHidden((h) => {
              const ids = engine.current?.leafIdsUnder(id) ?? [id];
              const n = new Set(h);
              const allHidden = ids.every((x) => n.has(x));
              for (const x of ids) allHidden ? n.delete(x) : n.add(x);
              return n;
            })}
            onPick={(node) => { setPicked({ name: node.name, code: node.code }); onPick(node.code); }}
            lang={lang}
          />
        )}
        <div ref={host} className={`cv-canvas cv-3d cv-mode-${mode}`} tabIndex={0} aria-label={w(lang, "3D model")}>
          {state === "loading" && <p className="cv-msg">{w(lang, "Loading the 3D model…")}</p>}
          {state === "error" && <p className="cv-msg">{w(lang, "The 3D model couldn't be loaded.")}</p>}
          {state === "nogl" && <p className="cv-msg">{w(lang, "This browser can't show 3D. Use the drawing instead.")}</p>}
          {hover && state === "ready" && mode === "turn" && (
            <span className="cv-tip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
              <b>{hover.code ?? hover.name}</b>{hover.code && describe?.(hover.code) ? ` ${describe(hover.code)}` : ""}
            </span>
          )}
          {picked && state === "ready" && (
            <div className="cv-card">
              <div className="cv-card-head">
                <b className="mono">{picked.code ?? picked.name}</b>
                {picked.code && describe?.(picked.code) && <span>{describe(picked.code)}</span>}
                <button type="button" className="cv-x" aria-label={w(lang, "Clear selection")} onClick={() => { setPicked(null); onPick(null); }}>×</button>
              </div>
              {picked.code && !knownCodes.has(picked.code) && <em className="cv-warn">{w(lang, "Not in the parts list")}</em>}
              {picked.code && knownCodes.has(picked.code) && card?.(picked.code)}
            </div>
          )}
        </div>
      </div>
      <p className="cv-hint">{hint}</p>
    </div>
  );
}

function ModelTree({ tree, hidden, selected, onToggle, onPick, lang }: {
  tree: TreeNode; hidden: Set<string>; selected: string | null; onToggle: (id: string) => void; onPick: (n: TreeNode) => void; lang: Lang;
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set([tree.id]));
  const rows = useMemo(() => {
    const out: TreeNode[] = [];
    const walk = (n: TreeNode) => {
      if (out.length > 3000) return;
      out.push(n);
      if (open.has(n.id)) n.children.forEach(walk);
    };
    walk(tree);
    return out;
  }, [tree, open]);
  return (
    <div className="cv-tree" role="tree" aria-label={w(lang, "Model tree")}>
      {rows.map((n) => {
        const leafHidden = hidden.has(n.id);
        return (
          <div key={n.id} role="treeitem" aria-selected={!!n.code && n.code === selected} aria-expanded={n.children.length ? open.has(n.id) : undefined}
            className={`cv-node${n.code && n.code === selected ? " on" : ""}`} style={{ paddingLeft: 6 + n.depth * 12 }}>
            {n.children.length ? (
              <button type="button" className="cv-tw" aria-label={n.name} onClick={() => setOpen((o) => { const x = new Set(o); x.has(n.id) ? x.delete(n.id) : x.add(n.id); return x; })}>
                {open.has(n.id) ? "▾" : "▸"}
              </button>
            ) : <span className="cv-tw" />}
            <button type="button" className="cv-eye" aria-pressed={!leafHidden} aria-label={`${w(lang, "Hide")} ${n.name}`} onClick={() => onToggle(n.id)}>{leafHidden ? "○" : "●"}</button>
            <button type="button" className="cv-name" onClick={() => onPick(n)}>{n.code ?? n.name}{n.code && n.name !== n.code ? <small> {n.name}</small> : null}</button>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// The three.js side, kept apart from React so a re-render never rebuilds the scene.

interface Events {
  hit: (hit: { name: string; code: string | null } | null) => void;
  hover: (h: { x: number; y: number; code: string | null; name: string } | null) => void;
  moved: (n: number) => void;
  windowDone: () => void;
}

class Engine {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(40, 1, 0.01, 1000);
  controls: OrbitControls;
  root: THREE.Object3D | null = null;
  meshes: THREE.Mesh[] = [];
  base = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  codes = new Map<string, string | null>(); // node uuid -> code
  pieces: { obj: THREE.Object3D; home: THREE.Vector3; dir: THREE.Vector3 }[] = [];
  pieceSet = new Set<THREE.Object3D>();
  offsets = new Map<THREE.Object3D, { orig: THREE.Vector3; off: THREE.Vector3 }>(); // parts moved by hand
  explodeK = 0;
  box = new THREE.Box3();
  sphere = new THREE.Sphere();
  plane = new THREE.Plane();
  selectedIds = new Set<string>();
  selectedCode: string | null = null;
  hoverMesh: THREE.Mesh | null = null;
  known = new Set<string>();
  hidden = new Set<string>();
  xray = false;
  mode: Mode = "turn";
  hl = new THREE.MeshStandardMaterial({ color: 0xe30613, emissive: 0x7a0008, metalness: 0.2, roughness: 0.45 });
  hov = new THREE.MeshStandardMaterial({ color: 0x3a8dde, emissive: 0x0b2a4a, metalness: 0.2, roughness: 0.45 });
  ghost = new THREE.MeshStandardMaterial({ color: 0x9aa4ad, transparent: true, opacity: 0.12, depthWrite: false });
  glass = new THREE.MeshStandardMaterial({ color: 0xb8c2cc, transparent: true, opacity: 0.32, depthWrite: false, metalness: 0.1, roughness: 0.3 });
  ro: ResizeObserver;
  frame = 0;
  hoverFrame = 0;
  down: { x: number; y: number } | null = null;
  drag: { plane: THREE.Plane; start: THREE.Vector3; objs: { obj: THREE.Object3D; startLocal: THREE.Vector3; startWorld: THREE.Vector3 }[] } | null = null;
  box2d: HTMLDivElement;

  constructor(private el: HTMLElement, private on: Events) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.localClippingEnabled = true;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    el.appendChild(this.renderer.domElement);
    this.box2d = document.createElement("div");
    this.box2d.className = "cv-zbox";
    this.box2d.hidden = true;
    el.appendChild(this.box2d);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(3, 5, 4);
    this.scene.add(sun, new THREE.HemisphereLight(0xffffff, 0x444444, 0.6));
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = false;
    this.controls.screenSpacePanning = true;
    this.controls.addEventListener("change", () => this.render());
    const c = this.renderer.domElement;
    c.addEventListener("pointerdown", (e) => this.pointerDown(e));
    c.addEventListener("pointermove", (e) => this.pointerMove(e));
    c.addEventListener("pointerup", (e) => this.pointerUp(e));
    c.addEventListener("pointerleave", () => this.setHover(null, null));
    c.addEventListener("dblclick", (e) => {
      const hit = this.hitPart(e);
      if (hit?.code) {
        this.on.hit(hit);
        this.zoomTo(hit.code);
      }
    });
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(el);
    this.resize();
  }

  async load(src: string, map: () => Record<string, string>): Promise<TreeNode> {
    const gltf = await new GLTFLoader().loadAsync(src);
    const root = gltf.scene;
    this.root = root;
    this.scene.add(root);
    // Make the model's size sensible, whatever units the CAD used.
    this.box.setFromObject(root);
    const size = this.box.getSize(new THREE.Vector3()).length() || 1;
    root.scale.multiplyScalar(4 / size);
    root.updateMatrixWorld(true);
    this.box.setFromObject(root);
    this.box.getBoundingSphere(this.sphere);
    const meshMap = map();
    root.traverse((o) => {
      this.codes.set(o.uuid, codeOf(o.name, meshMap));
      if ((o as THREE.Mesh).isMesh) {
        const m = o as THREE.Mesh;
        this.meshes.push(m);
        this.base.set(m, m.material);
      }
    });
    this.buildPieces(root);
    this.view("iso");
    return this.treeOf(root, 0);
  }

  treeOf(o: THREE.Object3D, depth: number): TreeNode {
    // Skip nameless wrapper nodes so the tree reads like the CAD tree.
    const kids = o.children.flatMap((c) => (!c.name && !(c as THREE.Mesh).isMesh && c.children.length ? c.children : [c]));
    return { id: o.uuid, name: o.name || (depth ? "–" : "Model"), code: this.codes.get(o.uuid) ?? null, depth, children: kids.map((c) => this.treeOf(c, depth + 1)) };
  }

  /** The units that move apart when exploding: the first level with more than two parts. */
  buildPieces(root: THREE.Object3D) {
    let level: THREE.Object3D[] = [root];
    for (let i = 0; i < 8 && level.length < 3; i++) {
      const next = level.flatMap((o) => (o.children.length ? o.children : [o]));
      if (next.length === level.length && next.every((o, j) => o === level[j])) break; // nothing deeper
      level = next;
    }
    const centre = this.sphere.center;
    this.pieces = level.map((obj) => {
      const c = new THREE.Box3().setFromObject(obj).getCenter(new THREE.Vector3());
      const dir = c.sub(centre);
      // Turn the world direction into the piece's parent's space, so moving it works at any depth.
      const inv = new THREE.Matrix4().copy(obj.parent!.matrixWorld).invert();
      const local = dir.clone().applyMatrix4(new THREE.Matrix4().extractRotation(inv)).divideScalar(obj.parent!.getWorldScale(new THREE.Vector3()).x || 1);
      return { obj, home: obj.position.clone(), dir: local };
    });
    this.pieceSet = new Set(this.pieces.map((p) => p.obj));
  }

  /** The outermost nodes carrying this code (a part used twice has two). */
  nodesFor(code: string | null): THREE.Object3D[] {
    if (!code || !this.root) return [];
    const out: THREE.Object3D[] = [];
    const walk = (o: THREE.Object3D) => {
      if (this.codes.get(o.uuid) === code) out.push(o);
      else o.children.forEach(walk);
    };
    walk(this.root);
    return out;
  }
  idsFor(code: string | null): string[] {
    const out: string[] = [];
    for (const n of this.nodesFor(code)) n.traverse((x) => (x as THREE.Mesh).isMesh && out.push(x.uuid));
    return out;
  }
  leafIdsUnder(id: string): string[] {
    const o = this.root?.getObjectByProperty("uuid", id);
    const out: string[] = [];
    o?.traverse((x) => (x as THREE.Mesh).isMesh && out.push(x.uuid));
    return out;
  }
  leafIdsExcept(keep: Set<string>): string[] {
    return this.meshes.filter((m) => !keep.has(m.uuid)).map((m) => m.uuid);
  }

  setSelected(code: string | null) {
    this.selectedCode = code;
    this.selectedIds = new Set(this.idsFor(code));
    this.paint();
  }
  setHidden(h: Set<string>) {
    this.hidden = h;
    for (const m of this.meshes) m.visible = !h.has(m.uuid);
    this.render();
  }
  setXray(on: boolean) {
    this.xray = on;
    this.paint();
  }
  paint() {
    const any = this.selectedIds.size > 0;
    for (const m of this.meshes) {
      if (this.selectedIds.has(m.uuid)) m.material = this.hl;
      else if (this.hoverMesh === m) m.material = this.hov;
      else if (this.xray) m.material = any ? this.ghost : this.glass;
      else m.material = this.base.get(m)!;
    }
    this.render();
  }

  // ---- positions: explode, and parts moved by hand ----
  place() {
    const k = this.explodeK * 1.2;
    for (const p of this.pieces) p.obj.position.copy(p.home).addScaledVector(p.dir, k);
    for (const [obj, o] of this.offsets) {
      if (!this.pieceSet.has(obj)) obj.position.copy(o.orig);
      obj.position.add(o.off);
    }
    this.render();
  }
  setExplode(f: number) {
    this.explodeK = f;
    this.place();
  }
  restore(code: string) {
    for (const n of this.nodesFor(code)) this.offsets.delete(n);
    this.on.moved(this.offsets.size);
    this.place();
  }
  restoreAll() {
    this.offsets.clear();
    this.on.moved(0);
    this.place();
  }

  setSection(axis: "x" | "y" | "z" | null, at: number) {
    if (!axis) {
      this.renderer.clippingPlanes = [];
    } else {
      const n = new THREE.Vector3(axis === "x" ? -1 : 0, axis === "y" ? -1 : 0, axis === "z" ? -1 : 0);
      const min = this.box.min[axis];
      const max = this.box.max[axis];
      this.plane.set(n, min + (max - min) * at);
      this.renderer.clippingPlanes = [this.plane];
    }
    this.render();
  }

  // ---- camera ----
  distFor(radius: number) {
    return radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 1.2;
  }
  aim(center: THREE.Vector3, dir: THREE.Vector3, dist: number) {
    this.camera.position.copy(center).addScaledVector(dir, dist);
    this.camera.near = Math.max(dist / 1000, this.sphere.radius / 10000);
    this.camera.far = dist * 100 + this.sphere.radius * 10;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(center);
    this.controls.update();
    this.render();
  }
  view(v: View) {
    const [x, y, z] = VIEWS[v];
    this.aim(this.sphere.center, new THREE.Vector3(x, y, z).normalize(), this.distFor(this.sphere.radius));
  }
  dir() {
    return this.camera.position.clone().sub(this.controls.target).normalize();
  }
  fitBox(b: THREE.Box3) {
    if (b.isEmpty()) return;
    const s = b.getBoundingSphere(new THREE.Sphere());
    this.aim(s.center, this.dir(), this.distFor(Math.max(s.radius, this.sphere.radius / 200)));
  }
  fit() {
    // Fit to what's showing, not to hidden parts.
    const vis = new THREE.Box3();
    for (const m of this.meshes) if (m.visible) vis.expandByObject(m);
    this.fitBox(vis.isEmpty() ? this.box : vis);
  }
  zoomTo(code: string) {
    const b = new THREE.Box3();
    for (const n of this.nodesFor(code)) b.expandByObject(n);
    this.fitBox(b);
  }
  zoom(f: number) {
    const t = this.controls.target;
    const d = this.camera.position.distanceTo(t) * f;
    this.aim(t.clone(), this.dir(), d);
  }
  currentView(): { pos: [number, number, number]; target: [number, number, number] } {
    return { pos: this.camera.position.toArray() as [number, number, number], target: this.controls.target.toArray() as [number, number, number] };
  }
  goTo(v: { pos: [number, number, number]; target: [number, number, number] }) {
    const t = new THREE.Vector3(...v.target);
    const p = new THREE.Vector3(...v.pos);
    this.aim(t, p.clone().sub(t).normalize(), p.distanceTo(t));
  }
  /** Zoom to a rectangle drawn on screen (pixels inside the canvas). */
  zoomWindow(x0: number, y0: number, x1: number, y1: number) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const bw = Math.abs(x1 - x0), bh = Math.abs(y1 - y0);
    if (bw < 6 || bh < 6) return;
    const cx = ((x0 + x1) / 2 / r.width) * 2 - 1;
    const cy = -((y0 + y1) / 2 / r.height) * 2 + 1;
    // The point under the box's middle, on the plane through the current target facing the camera.
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(cx, cy), this.camera);
    const facing = new THREE.Plane().setFromNormalAndCoplanarPoint(this.dir(), this.controls.target);
    const centre = ray.ray.intersectPlane(facing, new THREE.Vector3()) ?? this.controls.target.clone();
    const d = this.camera.position.distanceTo(this.controls.target) * Math.max(bw / r.width, bh / r.height);
    this.aim(centre, this.dir(), d);
  }

  snapshot(): string | null {
    // Draw now and read the pixels in the same task, before the browser clears the canvas.
    this.renderer.render(this.scene, this.camera);
    try {
      return this.renderer.domElement.toDataURL("image/png");
    } catch {
      return null;
    }
  }

  // ---- pointer ----
  ndc(e: { clientX: number; clientY: number }) {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }
  raycast(e: { clientX: number; clientY: number }) {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(this.ndc(e), this.camera);
    const clip = this.renderer.clippingPlanes[0];
    return { ray, hit: ray.intersectObjects(this.meshes.filter((m) => m.visible), false).find((h) => !clip || clip.distanceToPoint(h.point) >= 0) };
  }
  /** The part under the pointer: the first part on this sheet's list going up from the mesh, else the deepest coded part. */
  hitPart(e: { clientX: number; clientY: number }): { name: string; code: string | null; mesh: THREE.Mesh; point: THREE.Vector3 } | null {
    const { hit } = this.raycast(e);
    if (!hit) return null;
    let deepest: THREE.Object3D | null = null;
    for (let o: THREE.Object3D | null = hit.object; o; o = o.parent) {
      const code = this.codes.get(o.uuid);
      if (!code) continue;
      if (this.known.has(code)) return { name: o.name, code, mesh: hit.object as THREE.Mesh, point: hit.point };
      deepest ??= o;
    }
    return deepest
      ? { name: deepest.name, code: this.codes.get(deepest.uuid)!, mesh: hit.object as THREE.Mesh, point: hit.point }
      : { name: hit.object.name || "–", code: null, mesh: hit.object as THREE.Mesh, point: hit.point };
  }

  pointerDown(e: PointerEvent) {
    this.down = { x: e.clientX, y: e.clientY };
    this.setHover(null, null);
    if (e.button !== 0) return;
    if (this.mode === "window") {
      this.controls.enabled = false;
      this.renderer.domElement.setPointerCapture(e.pointerId);
      return;
    }
    if (this.mode === "move" && this.selectedCode) {
      const hit = this.hitPart(e);
      if (hit?.code === this.selectedCode) {
        this.controls.enabled = false;
        this.renderer.domElement.setPointerCapture(e.pointerId);
        this.drag = {
          plane: new THREE.Plane().setFromNormalAndCoplanarPoint(this.dir(), hit.point),
          start: hit.point.clone(),
          objs: this.nodesFor(this.selectedCode).map((obj) => ({ obj, startLocal: obj.position.clone(), startWorld: obj.getWorldPosition(new THREE.Vector3()) })),
        };
      }
    }
  }
  pointerMove(e: PointerEvent) {
    if (this.mode === "window" && this.down) {
      const r = this.renderer.domElement.getBoundingClientRect();
      const x0 = this.down.x - r.left, y0 = this.down.y - r.top, x1 = e.clientX - r.left, y1 = e.clientY - r.top;
      Object.assign(this.box2d.style, { left: `${Math.min(x0, x1)}px`, top: `${Math.min(y0, y1)}px`, width: `${Math.abs(x1 - x0)}px`, height: `${Math.abs(y1 - y0)}px` });
      this.box2d.hidden = false;
      return;
    }
    if (this.drag) {
      const { ray } = this.raycast(e);
      const p = ray.ray.intersectPlane(this.drag.plane, new THREE.Vector3());
      if (!p) return;
      const delta = p.sub(this.drag.start);
      for (const d of this.drag.objs) {
        const parent = d.obj.parent!;
        const a = parent.worldToLocal(d.startWorld.clone());
        const b = parent.worldToLocal(d.startWorld.clone().add(delta));
        // Remember where the CAD put it the first time it's moved, so Restore can put it back.
        if (!this.offsets.has(d.obj)) this.offsets.set(d.obj, { orig: d.startLocal.clone(), off: new THREE.Vector3() });
        d.obj.position.copy(d.startLocal).add(b.sub(a));
      }
      this.render();
      return;
    }
    if (e.buttons || e.pointerType !== "mouse") return;
    // Hover label, at most once a frame.
    if (this.hoverFrame) return;
    const pt = { clientX: e.clientX, clientY: e.clientY };
    this.hoverFrame = requestAnimationFrame(() => {
      this.hoverFrame = 0;
      const hit = this.hitPart(pt);
      const r = this.el.getBoundingClientRect();
      this.setHover(hit ? hit.mesh : null, hit ? { x: pt.clientX - r.left, y: pt.clientY - r.top, code: hit.code, name: hit.name } : null);
    });
  }
  pointerUp(e: PointerEvent) {
    const down = this.down;
    this.down = null;
    if (this.mode === "window" && down) {
      const r = this.renderer.domElement.getBoundingClientRect();
      this.box2d.hidden = true;
      this.controls.enabled = true;
      this.zoomWindow(down.x - r.left, down.y - r.top, e.clientX - r.left, e.clientY - r.top);
      this.on.windowDone();
      return;
    }
    if (this.drag) {
      this.drag = null;
      this.controls.enabled = true;
      this.fixOffsets();
      this.on.moved(this.offsets.size);
      return;
    }
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5 && e.button === 0) {
      const hit = this.hitPart(e);
      this.on.hit(hit ? { name: hit.name, code: hit.code } : null);
    }
  }
  /** After a drag, store each moved part's offset from where explode (or the CAD) would put it. */
  fixOffsets() {
    const k = this.explodeK * 1.2;
    for (const [obj, o] of this.offsets) {
      const piece = this.pieces.find((p) => p.obj === obj);
      const basePos = piece ? piece.home.clone().addScaledVector(piece.dir, k) : o.orig;
      o.off.copy(obj.position).sub(basePos);
    }
  }
  setHover(mesh: THREE.Mesh | null, label: { x: number; y: number; code: string | null; name: string } | null) {
    if (this.hoverMesh !== mesh) {
      this.hoverMesh = mesh;
      this.paint();
    }
    this.on.hover(label);
  }

  resize() {
    const w = this.el.clientWidth || 1;
    const h = this.el.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.render();
  }
  render() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.renderer.render(this.scene, this.camera);
    });
  }
  dispose() {
    cancelAnimationFrame(this.frame);
    cancelAnimationFrame(this.hoverFrame);
    this.ro.disconnect();
    this.controls.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        const mats = this.base.get(m) ?? m.material;
        (Array.isArray(mats) ? mats : [mats]).forEach((x) => x.dispose());
      }
    });
    for (const m of [this.hl, this.hov, this.ghost, this.glass]) m.dispose();
    this.scene.environment?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.box2d.remove();
  }
}

