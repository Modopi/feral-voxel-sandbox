import { PIXEL as P } from "./character-model.js";
import {
  skeleton,
  structureState,
  evaluateStructure,
  breakBone,
  saveStructure,
} from "./structural-body.js";
const templates = new WeakMap();
const physical = (id) =>
  /^(torso|head|arm[LR]|forearm[LR]|hand[LR]|leg[LR]|shin[LR]|foot[LR])$/.test(
    id,
  );
export function characterSkeleton(model) {
  if (templates.has(model)) return templates.get(model);
  const bones = new Map(model.bones.map((b) => [b.id, b])),
    world = new Map();
  for (const b of model.bones)
    world.set(
      b.id,
      b.pivot.map((v, i) => v + (world.get(b.parent)?.[i] || 0)),
    );
  const nodes = [];
  for (const b of model.bones.filter((b) => physical(b.id))) {
    const ys =
      b.id === "torso"
        ? [1, 6, 12]
        : b.id === "head"
          ? [2, 6]
          : b.id.startsWith("arm")
            ? [-1, -7]
            : b.id.startsWith("forearm")
              ? [-1, -6]
              : b.id.startsWith("leg")
                ? [-1, -9]
                : b.id.startsWith("shin")
                  ? [-1, -7]
                  : [-1];
    ys.forEach((y, i) =>
      nodes.push({
        id: `${b.id}:${i}`,
        part: b.id,
        at: [0, y * P, b.id.startsWith("foot") ? P : 0],
        size: [P * 1.5, P * 1.5, P * 1.5],
        hp: b.id === "torso" || b.id === "head" ? 36 : 24,
        links: [],
      }),
    );
  }
  const link = (a, b) => {
    a.links.push(b.id);
    b.links.push(a.id);
  };
  for (const b of model.bones.filter((b) => physical(b.id))) {
    const own = nodes.filter((n) => n.part === b.id);
    for (let i = 1; i < own.length; i++) link(own[i - 1], own[i]);
    const parent = b.parent === "root" ? "torso" : b.parent;
    if (b.id === "torso") continue;
    const candidates = nodes.filter((n) => n.part === parent),
      a = own[0];
    candidates.sort(
      (x, y) =>
        Math.hypot(
          ...x.at.map(
            (v, i) => v + world.get(x.part)[i] - world.get(a.part)[i] - a.at[i],
          ),
        ) -
        Math.hypot(
          ...y.at.map(
            (v, i) => v + world.get(y.part)[i] - world.get(a.part)[i] - a.at[i],
          ),
        ),
    );
    link(a, candidates[0]);
  }
  const functions = {};
  for (const side of ["L", "R"])
    for (const kind of ["leg", "arm"])
      functions[kind + side] = nodes
        .filter((n) =>
          (kind === "leg"
            ? ["leg", "shin", "foot"]
            : ["arm", "forearm", "hand"]
          ).some((prefix) => n.part === prefix + side),
        )
        .map((n) => n.id);
  const graph = skeleton(nodes, "torso:1", functions, ["head:1", "torso:2"]);
  graph.pieces = nodes.map((n) => ({
    part: n.part,
    node: n.id,
    at: n.at,
    size: n.size,
  }));
  for (const n of nodes)
    for (const id of n.links) {
      const b = nodes.find((v) => v.id === id);
      if (n.id >= b.id) continue;
      const part =
          n.part === b.part
            ? n.part
            : bones.get(n.part).parent === b.part ||
                (bones.get(n.part).parent === "root" && b.part === "torso")
              ? n.part
              : b.part,
        origin = world.get(part);
      let a = n.at.map((v, i) => v + world.get(n.part)[i] - origin[i]);
      const end = b.at.map((v, i) => v + world.get(b.part)[i] - origin[i]);
      for (let axis = 0; axis < 3; axis++)
        if (Math.abs(a[axis] - end[axis]) > 0.001) {
          const c = [...a];
          c[axis] = end[axis];
          const size = [P, P, P];
          size[axis] = Math.abs(c[axis] - a[axis]) + P;
          graph.pieces.push({
            part,
            node: n.part === part ? n.id : b.id,
            other: n.part === part ? b.id : n.id,
            at: a.map((v, i) => (v + c[i]) / 2),
            size,
          });
          a = c;
        }
    }
  graph.parts = bones;
  graph.skin = new Map();
  templates.set(model, graph);
  return graph;
}
const key = (x, y, z) => `${x},${y},${z}`;
export function skinVoxels(graph, part) {
  if (graph.skin.has(part)) return graph.skin.get(part);
  const cells = new Map();
  for (const b of graph.parts.get(part).boxes) {
    const low = b.at.map((v, i) => Math.round((v - b.size[i] / 2) / P)),
      high = b.at.map((v, i) => Math.round((v + b.size[i] / 2) / P));
    for (let x = low[0]; x < high[0]; x++)
      for (let y = low[1]; y < high[1]; y++)
        for (let z = low[2]; z < high[2]; z++)
          cells.set(key(x, y, z), {
            key: key(x, y, z),
            grid: [x, y, z],
            at: [(x + 0.5) * P, (y + 0.5) * P, (z + 0.5) * P],
            size: [P, P, P],
            color: b.color,
            texture: b.texture,
          });
  }
  graph.skin.set(part, cells);
  return cells;
}
export class CharacterBody {
  constructor(model, saved) {
    this.model = characterSkeleton(model);
    this.structure = structureState(this.model, saved?.structure);
    this.shell = new Map();
    this.revision = 0;
    if (saved && saved.version !== 1)
      throw Error("Unsupported character body version");
    for (const [part, keys] of Object.entries(saved?.shell || {})) {
      if (
        !this.model.parts.has(part) ||
        !Array.isArray(keys) ||
        keys.length > 20000
      )
        throw Error("Invalid character surface");
      const cells = skinVoxels(this.model, part);
      if (keys.some((k) => !cells.has(k)))
        throw Error("Unknown character voxel");
      this.shell.set(part, new Set(keys));
    }
  }
  status() {
    return evaluateStructure(this.model, this.structure);
  }
  attached(part) {
    let p = this.model.parts.get(part);
    while (p && !physical(p.id)) p = this.model.parts.get(p.parent);
    return (
      !p ||
      this.model.nodes.some(
        (n) => n.part === p.id && this.status().connected.has(n.id),
      )
    );
  }
  removeSurface(part, point, radius) {
    const cells = skinVoxels(this.model, part),
      removed = this.shell.get(part) || new Set();
    let count = 0;
    for (const v of cells.values())
      if (
        !removed.has(v.key) &&
        Math.hypot(...v.at.map((n, i) => n - point[i])) <= radius
      ) {
        removed.add(v.key);
        count++;
      }
    if (count) {
      this.shell.set(part, removed);
      this.revision++;
    }
    return count;
  }
  damageBone(node, amount) {
    const result = breakBone(this.model, this.structure, node, amount);
    if (result.damage) this.revision++;
    return result;
  }
  save() {
    return {
      version: 1,
      structure: saveStructure(this.structure),
      shell: Object.fromEntries(
        [...this.shell].map(([k, v]) => [k, [...v].sort()]),
      ),
    };
  }
}
