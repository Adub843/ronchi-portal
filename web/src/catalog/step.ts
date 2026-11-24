// Turning a STEP file (exported from Fusion, SolidWorks or Creo) into a GLB 3D model, in the
// browser, with OpenCascade compiled to WebAssembly (occt-import-js, LGPL; see README).
// Part names from the CAD are kept as node names, so the viewer can match them to part codes.
import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import occtimportjs from "occt-import-js";
import wasmUrl from "occt-import-js/dist/occt-import-js.wasm?url";

interface OcctMesh {
  name: string;
  color?: [number, number, number];
  attributes: { position: { array: number[] }; normal?: { array: number[] } };
  index: { array: number[] };
}
interface OcctNode {
  name: string;
  meshes: number[];
  children: OcctNode[];
}

export async function stepToGlb(file: File): Promise<{ glb: Blob; parts: number; names: string[] }> {
  const occt = await occtimportjs({ locateFile: () => wasmUrl });
  const res = occt.ReadStepFile(new Uint8Array(await file.arrayBuffer()), {
    linearUnit: "millimeter",
    linearDeflectionType: "bounding_box_ratio",
    linearDeflection: 0.0008,
    angularDeflection: 0.4,
  }) as { success: boolean; root: OcctNode; meshes: OcctMesh[] };
  if (!res.success) throw new Error("That STEP file couldn't be read. Export it again as STEP AP214 or AP242.");

  const mats = new Map<string, THREE.MeshStandardMaterial>();
  const material = (c?: [number, number, number]) => {
    const key = c ? c.map((v) => v.toFixed(3)).join() : "steel";
    if (!mats.has(key)) {
      mats.set(key, new THREE.MeshStandardMaterial({
        color: c ? new THREE.Color(c[0], c[1], c[2]) : new THREE.Color(0.72, 0.74, 0.77),
        metalness: c ? 0.25 : 0.6,
        roughness: c ? 0.5 : 0.35,
      }));
    }
    return mats.get(key)!;
  };
  const names = new Set<string>();
  let parts = 0;
  const build = (n: OcctNode): THREE.Object3D => {
    const g = new THREE.Group();
    g.name = n.name ?? "";
    if (g.name) names.add(g.name);
    for (const i of n.meshes) {
      const m = res.meshes[i]!;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(m.attributes.position.array, 3));
      if (m.attributes.normal) geo.setAttribute("normal", new THREE.Float32BufferAttribute(m.attributes.normal.array, 3));
      else geo.computeVertexNormals();
      geo.setIndex(m.index.array);
      const mesh = new THREE.Mesh(geo, material(m.color));
      mesh.name = m.name || g.name;
      if (mesh.name) names.add(mesh.name);
      g.add(mesh);
      parts++;
    }
    for (const c of n.children) g.add(build(c));
    return g;
  };
  const root = build(res.root);
  // CAD is Z-up; the viewer is Y-up.
  root.rotation.x = -Math.PI / 2;
  const scene = new THREE.Scene();
  scene.add(root);
  const out = (await new GLTFExporter().parseAsync(scene, { binary: true })) as ArrayBuffer;
  root.traverse((o) => (o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry.dispose());
  mats.forEach((m) => m.dispose());
  return { glb: new Blob([out], { type: "model/gltf-binary" }), parts, names: [...names] };
}
