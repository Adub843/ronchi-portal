// Splitting one 3D model of a whole machine onto the machine's parts lists: each parts list whose
// assembly number appears in the model gets that assembly's part of it. Plain tree logic, so it
// works the same on a three.js scene and can be tested without one.
import { codeOf } from "./codes";

export interface NamedNode {
  name: string;
  children: NamedNode[];
}

/**
 * For each wanted assembly number, the first node in the model that stands for it, searching level
 * by level so the outermost copy wins (CAD repeats an assembly as GS095008-1, GS095008-2, ...).
 */
export function findAssemblies<T extends { name: string; children: readonly T[] }>(root: T, codes: Iterable<string>): Map<string, T> {
  const wanted = new Set([...codes].map((c) => c.toUpperCase()));
  const hits = new Map<string, T>();
  let level: readonly T[] = [root];
  while (level.length && hits.size < wanted.size) {
    const next: T[] = [];
    for (const node of level) {
      const code = codeOf(node.name, {});
      if (code && wanted.has(code) && !hits.has(code)) hits.set(code, node);
      next.push(...node.children);
    }
    level = next;
  }
  return hits;
}
