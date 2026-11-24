// The 3D model of an assembly, CAD-style: turn, move and zoom; click a part to select it (and its
// row in the parts list); hide it, isolate it, see through everything else, pull the assembly
// apart (explode), cut it open (section), jump to standard views, and show or hide any part from
// the model tree. Works with a mouse, a trackpad or fingers.
//
// The model is a GLB file. Each part's node name is matched to a Ronchi part code through the
// sheet's mesh map (set by staff), or by the name itself when it starts with a part code (that's
// how SolidWorks and Creo name parts: GF010526, GF010526-1, GF010526_2 ...).
import { useEffect, useMemo, useRef, useState } from "react";
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

type View = "iso" | "front" | "back" | "left" | "right" | "top" | "bottom";
const VIEWS: Record<View, [number, number, number]> = {
  iso: [1, 0.8, 1], front: [0, 0, 1], back: [0, 0, -1], left: [-1, 0, 0], right: [1, 0, 0], top: [0, 1, 0.0001], bottom: [0, -1, 0.0001],
};
const VIEW_WORDS: Record<View, "Iso" | "Front" | "Back" | "Left" | "Right" | "Top" | "Bottom"> = {
  iso: "Iso", front: "Front", back: "Back", left: "Left", right: "Right", top: "Top", bottom: "Bottom",
};

export function Model3D({
  src, meshMap, selected, onPick, lang, knownCodes,
}: {
  src: string;
  meshMap: Record<string, string>;
  selected: string | null;                 // the selected part code
  onPick: (code: string | null) => void;
  lang: Lang;
  knownCodes: Set<string>;                 // codes in the parts list, to say when a clicked part isn't listed
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
  const [full, setFull] = useState(false);
  const [picked, setPicked] = useState<{ name: string; code: string | null } | null>(null);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const mapRef = useRef(meshMap);
  mapRef.current = meshMap;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let e: Engine;
    try {
      e = new Engine(el, (hit) => {
        setPicked(hit);
        pickRef.current(hit?.code ?? null);
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
  useEffect(() => engine.current?.setSelected(selected), [selected, state]);
  useEffect(() => engine.current?.setHidden(hidden), [hidden, state]);
  useEffect(() => engine.current?.setXray(xray), [xray, state]);
  useEffect(() => engine.current?.setExplode(explode), [explode, state]);
  useEffect(() => engine.current?.setSection(section.axis, section.at), [section, state]);
  useEffect(() => engine.current?.resize(), [full, showTree]);

  const selectedIds = () => engine.current?.idsFor(selected) ?? [];
  const hide = () => setHidden((h) => new Set([...h, ...selectedIds()]));
  const isolate = () => {
    const keep = new Set(selectedIds());
    if (!keep.size || !engine.current) return;
    setHidden(new Set(engine.current.leafIdsExcept(keep)));
  };

  return (
    <div className={`cv-stage${full ? " cv-full" : ""}`}>
      <div className="cv-tools" role="toolbar" aria-label="3D">
        <button type="button" className="cv-btn" onClick={() => engine.current?.fit()}>{w(lang, "Fit")}</button>
        <label className="cv-select">
          <span className="sr">{w(lang, "Views")}</span>
          <select aria-label={w(lang, "Views")} value="" onChange={(e) => { if (e.target.value) engine.current?.view(e.target.value as View); }}>
            <option value="">{w(lang, "Views")}</option>
            {(Object.keys(VIEWS) as View[]).map((v) => <option key={v} value={v}>{w(lang, VIEW_WORDS[v])}</option>)}
          </select>
        </label>
        <button type="button" className="cv-btn" onClick={hide} disabled={!selected}>{w(lang, "Hide")}</button>
        <button type="button" className="cv-btn" onClick={isolate} disabled={!selected}>{w(lang, "Isolate")}</button>
        <button type="button" className="cv-btn" onClick={() => { setHidden(new Set()); setXray(false); setExplode(0); setSection({ axis: null, at: 0.5 }); }}>{w(lang, "Show all")}</button>
        <button type="button" className="cv-btn" aria-pressed={xray} onClick={() => setXray(!xray)}>{w(lang, "See-through")}</button>
        <label className="cv-range">
          {w(lang, "Explode")}
          <input type="range" min={0} max={1} step={0.01} value={explode} onChange={(e) => setExplode(Number(e.target.value))} />
        </label>
        <label className="cv-select">
          {w(lang, "Section")}
          <select value={section.axis ?? ""} onChange={(e) => setSection({ ...section, axis: (e.target.value || null) as "x" | "y" | "z" | null })}>
            <option value="">{w(lang, "Off")}</option>
            <option value="x">X</option>
            <option value="y">Y</option>
            <option value="z">Z</option>
          </select>
        </label>
        {section.axis && (
          <input className="cv-slim" type="range" min={0} max={1} step={0.005} value={section.at} aria-label={w(lang, "Section")} onChange={(e) => setSection({ ...section, at: Number(e.target.value) })} />
        )}
        <span className="cv-gap" />
        <button type="button" className="cv-btn" aria-pressed={showTree} onClick={() => setShowTree(!showTree)}>{w(lang, "Model tree")}</button>
        <button type="button" className="cv-btn" aria-pressed={full} onClick={() => setFull(!full)}>{w(lang, full ? "Exit full screen" : "Full screen")}</button>
      </div>
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
        <div ref={host} className="cv-canvas cv-3d">
          {state === "loading" && <p className="cv-msg">{w(lang, "Loading the 3D model…")}</p>}
          {state === "error" && <p className="cv-msg">{w(lang, "The 3D model couldn't be loaded.")}</p>}
          {state === "nogl" && <p className="cv-msg">{w(lang, "This browser can't show 3D. Use the drawing instead.")}</p>}
          {picked && state === "ready" && (
            <p className="cv-picked">
              {w(lang, "Selected: {name}", { name: picked.code ?? picked.name })}
              {picked.code && !knownCodes.has(picked.code) && <em> · {w(lang, "Not in the parts list")}</em>}
              <button type="button" className="cv-x" aria-label={w(lang, "Clear selection")} onClick={() => { setPicked(null); onPick(null); }}>×</button>
            </p>
          )}
        </div>
      </div>
      <p className="cv-hint">{w(lang, "Drag to turn. Right-drag or two fingers to move. Scroll or pinch to zoom. Click a part to select it.")}</p>
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
  box = new THREE.Box3();
  sphere = new THREE.Sphere();
  plane = new THREE.Plane();
  selectedIds = new Set<string>();
  known = new Set<string>();
  hidden = new Set<string>();
  xray = false;
  hl = new THREE.MeshStandardMaterial({ color: 0xe30613, emissive: 0x7a0008, metalness: 0.2, roughness: 0.45 });
  ghost = new THREE.MeshStandardMaterial({ color: 0x9aa4ad, transparent: true, opacity: 0.12, depthWrite: false });
  glass = new THREE.MeshStandardMaterial({ color: 0xb8c2cc, transparent: true, opacity: 0.32, depthWrite: false, metalness: 0.1, roughness: 0.3 });
  ro: ResizeObserver;
  frame = 0;
  down: { x: number; y: number } | null = null;

  constructor(private el: HTMLElement, private onHit: (hit: { name: string; code: string | null } | null) => void) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.localClippingEnabled = true;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    el.appendChild(this.renderer.domElement);
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
    c.addEventListener("pointerdown", (e) => (this.down = { x: e.clientX, y: e.clientY }));
    c.addEventListener("pointerup", (e) => {
      if (this.down && Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) < 5 && e.button === 0) this.pick(e);
      this.down = null;
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
  }

  idsFor(code: string | null): string[] {
    if (!code || !this.root) return [];
    const out: string[] = [];
    this.root.traverse((o) => {
      if (this.codes.get(o.uuid) === code) o.traverse((x) => (x as THREE.Mesh).isMesh && out.push(x.uuid));
    });
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
      else if (this.xray) m.material = any ? this.ghost : this.glass;
      else m.material = this.base.get(m)!;
    }
    this.render();
  }
  setExplode(f: number) {
    const k = f * 1.2;
    for (const p of this.pieces) p.obj.position.copy(p.home).addScaledVector(p.dir, k);
    this.render();
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

  view(v: View) {
    const [x, y, z] = VIEWS[v];
    const dir = new THREE.Vector3(x, y, z).normalize();
    const dist = this.sphere.radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 1.2;
    this.camera.position.copy(this.sphere.center).addScaledVector(dir, dist);
    this.camera.near = dist / 100;
    this.camera.far = dist * 100;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(this.sphere.center);
    this.controls.update();
    this.render();
  }
  fit() {
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    // Fit to what's showing, not to hidden parts.
    const vis = new THREE.Box3();
    for (const m of this.meshes) if (m.visible) vis.expandByObject(m);
    const s = vis.isEmpty() ? this.sphere : vis.getBoundingSphere(new THREE.Sphere());
    const dist = s.radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 1.2;
    this.camera.position.copy(s.center).addScaledVector(dir, dist);
    this.controls.target.copy(s.center);
    this.controls.update();
    this.render();
  }

  pick(e: PointerEvent) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const p = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(p, this.camera);
    const clip = this.renderer.clippingPlanes[0];
    const hit = ray.intersectObjects(this.meshes.filter((m) => m.visible), false)
      .find((h) => !clip || clip.distanceToPoint(h.point) >= 0);
    if (!hit) return this.onHit(null);
    // Walk up from the mesh: the first part that's on this sheet's parts list wins (a clutch disc
    // selects the clutch on the capping head's list); otherwise the deepest part with a code.
    let deepest: THREE.Object3D | null = null;
    for (let o: THREE.Object3D | null = hit.object; o; o = o.parent) {
      const code = this.codes.get(o.uuid);
      if (!code) continue;
      if (this.known.has(code)) return this.onHit({ name: o.name, code });
      deepest ??= o;
    }
    this.onHit(deepest ? { name: deepest.name, code: this.codes.get(deepest.uuid)! } : { name: hit.object.name || "–", code: null });
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
    this.hl.dispose();
    this.ghost.dispose();
    this.glass.dispose();
    this.scene.environment?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
