import {
  skeleton,
  structureState,
  boneHealth,
  breakBone,
  evaluateStructure,
} from "./structural-body.js";
const models = new WeakMap();
function center(p, j) {
  const [nx, ny, nz] = p.dims;
  return [
    ((j % nx) + 0.5 - nx / 2) * p.cell,
    ((Math.floor(j / nx) % ny) + 0.5 - (p.leg ? ny : ny / 2)) * p.cell,
    (Math.floor(j / (nx * ny)) + 0.5 - nz / 2) * p.cell,
  ];
}
export function animalSkeleton(species) {
  if (models.has(species)) return models.get(species);
  const nodes = [],
    parts = species.parts;
  for (let pi = 0; pi < parts.length; pi++) {
    const p = parts[pi],
      [nx, ny, nz] = p.dims;
    for (let j = 0; j < p.count; j++) {
      const x = j % nx,
        y = Math.floor(j / nx) % ny,
        z = Math.floor(j / (nx * ny));
      // Trunk: longitudinal spine plus two load-bearing shoulder/pelvis bars.
      if (
        pi === 0 &&
        !((x === 1 && y === ny - 1) || ((z === 0 || z === nz - 1) && y === 0))
      )
        continue;
      nodes.push({
        id: `${pi}:${j}`,
        part: pi,
        voxel: j,
        at: center(p, j),
        size: [p.cell * 0.28, p.cell * 0.28, p.cell * 0.28],
        hp: pi < 2 ? 30 : pi < 6 ? 24 : 12,
        links: [],
      });
    }
  }
  const link = (a, b) => {
    if (!a.links.includes(b.id)) a.links.push(b.id);
    if (!b.links.includes(a.id)) b.links.push(a.id);
  };
  for (const a of nodes)
    for (const b of nodes) {
      if (a === b || a.part !== b.part) continue;
      const p = parts[a.part];
      if (
        Math.abs(
          a.at.reduce((sum, v, i) => sum + Math.abs(v - b.at[i]), 0) - p.cell,
        ) < 1e-6
      )
        link(a, b);
    }
  const attachments = {};
  for (let pi = 1; pi < parts.length; pi++) {
    const p = parts[pi],
      own = nodes.filter((n) => n.part === pi),
      parents = nodes.filter((n) => n.part === p.parent);
    let pair,
      best = Infinity;
    for (const a of own)
      for (const b of parents) {
        const d = Math.hypot(
          ...a.at.map(
            (v, i) => v + p.offset[i] - b.at[i] - parts[b.part].offset[i],
          ),
        );
        if (d < best) {
          best = d;
          pair = [a, b];
        }
      }
    if (pair) {
      link(...pair);
      attachments[pi] = pair[0].id;
    }
  }
  const root = nodes.find(
    (n) =>
      n.part === 0 &&
      n.voxel % parts[0].dims[0] === 1 &&
      Math.floor(n.voxel / (parts[0].dims[0] * parts[0].dims[1])) === 1 &&
      Math.floor(n.voxel / parts[0].dims[0]) % parts[0].dims[1] === 1,
  ).id;
  const brain = nodes.find((n) => n.part === 1 && n.voxel === 0).id;
  const functions = {};
  for (let pi = 2; pi <= 5; pi++)
    functions[`leg${pi}`] = nodes.filter((n) => n.part === pi).map((n) => n.id);
  const model = skeleton(nodes, root, functions, [brain]);
  model.attachments = attachments;
  model.brain = brain;
  model.parts = parts;
  // Nodes and connecting shafts form the visible/selectable internal structure.
  model.pieces = nodes.map((n) => ({
    part: n.part,
    node: n.id,
    at: n.at,
    size: n.size,
  }));
  for (const a of nodes)
    for (const id of a.links) {
      const b = nodes.find((n) => n.id === id);
      if (a.id >= b.id) continue;
      const part = a.part === b.part ? a.part : Math.max(a.part, b.part),
        p = parts[part];
      const aa = a.at.map((v, i) => v + parts[a.part].offset[i] - p.offset[i]),
        bb = b.at.map((v, i) => v + parts[b.part].offset[i] - p.offset[i]);
      // Axis-aligned stepped shafts retain a voxel silhouette across part anchors.
      let from = aa;
      for (let axis = 0; axis < 3; axis++) {
        if (Math.abs(bb[axis] - from[axis]) < 0.005) continue;
        const end = [...from];
        end[axis] = bb[axis];
        const size = [p.cell * 0.19, p.cell * 0.19, p.cell * 0.19];
        size[axis] = Math.abs(end[axis] - from[axis]) + p.cell * 0.19;
        model.pieces.push({
          part,
          node: a.part === part ? a.id : b.id,
          other: a.part === part ? b.id : a.id,
          at: from.map((v, i) => (v + end[i]) / 2),
          size,
        });
        from = end;
      }
    }
  models.set(species, model);
  return model;
}
export function createAnimalStructure(e, species, legacy = false) {
  const model = animalSkeleton(species),
    state = structureState(model, e.structure);
  for (const n of model.nodes)
    if (e.lost & (1 << n.part) || (legacy && e.damage[n.part]?.[n.voxel] === 0))
      breakBone(model, state, n.id, n.hp);
  e.structure = state;
  return state;
}
export function animalStructure(e, species) {
  if (!e.structure) createAnimalStructure(e, species, true);
  return evaluateStructure(animalSkeleton(species), e.structure);
}
export function bonePieces(e, species) {
  const model = animalSkeleton(species);
  animalStructure(e, species);
  return model.pieces.filter(
    (p) =>
      !(e.lost & (1 << p.part)) &&
      boneHealth(model, e.structure, p.node) > 0 &&
      (!p.other || boneHealth(model, e.structure, p.other) > 0),
  );
}
export function breakAnimalPart(e, species, part) {
  const model = animalSkeleton(species);
  for (const n of model.nodes)
    if (n.part === part) breakBone(model, e.structure, n.id, n.hp);
}
export function animalBodyInfo(e, species) {
  const state = animalStructure(e, species);
  let total = 0,
    left = 0;
  species.parts.forEach((p, pi) => {
    total += p.count;
    for (let j = 0; j < p.count; j++)
      if (!(e.lost & (1 << pi)) && e.damage[pi]?.[j] !== 0) left++;
  });
  return {
    shell: Math.round((left / total) * 100),
    structure: Math.round(state.integrity * 100),
    alive: state.alive,
  };
}
