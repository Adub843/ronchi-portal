// Turning a STEP file (exported from Fusion, SolidWorks or Creo) into a GLB 3D model, in the
// browser, with OpenCascade compiled to WebAssembly (occt-import-js, LGPL; see README).
// Part names from the CAD are kept as node names, so the viewer can match them to part codes.
import * as THREE from "three";
import occtimportjs from "occt-import-js";
import wasmUrl from "occt-import-js/dist/occt-import-js.wasm?url";
import { objectToGlbBytes, occtToObject, STEP_READ_OPTIONS, type OcctResult } from "../../catalog/step-core";

/** Read a STEP file into a three.js object tree (Y-up), keeping the CAD names on the nodes. */
export async function stepToObject(file: File): Promise<{ root: THREE.Object3D; parts: number; names: string[]; dispose: () => void }> {
  const occt = await occtimportjs({ locateFile: () => wasmUrl });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const res = occt.ReadStepFile(bytes, STEP_READ_OPTIONS) as OcctResult;
  if (!res.success) throw new Error("That STEP file couldn't be read. Export it again as STEP AP214 or AP242.");
  return occtToObject(res, bytes);
}

/** One node of a model as its own GLB, placed where it sits in the whole model. */
export async function objectToGlb(node: THREE.Object3D): Promise<Blob> {
  return new Blob([await objectToGlbBytes(node)], { type: "model/gltf-binary" });
}

export async function stepToGlb(file: File): Promise<{ glb: Blob; parts: number; names: string[] }> {
  const r = await stepToObject(file);
  try {
    return { glb: await objectToGlb(r.root), parts: r.parts, names: r.names };
  } finally {
    r.dispose();
  }
}

/** Read a GLB file into a three.js object tree. */
export async function glbToObject(file: File): Promise<THREE.Object3D> {
  const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
  const gltf = await new GLTFLoader().parseAsync(await file.arrayBuffer(), "");
  gltf.scene.updateMatrixWorld(true);
  return gltf.scene;
}
