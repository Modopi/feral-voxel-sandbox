// Engine-independent load-bearing graph. Animation transforms and exterior voxels
// are adapters: neither may infer a broken bone from a missing surface cell.
export function skeleton(nodes, root, functions = {}, vital = []) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  if (!byId.has(root) || byId.size !== nodes.length)
    throw Error("Invalid skeleton root/ids");
  for (const n of nodes) {
    n.links ||= [];
    if (!(n.hp > 0)) throw Error("Invalid bone capacity");
    for (const id of n.links)
      if (!byId.has(id)) throw Error("Unknown bone link");
  }
  return { nodes, byId, root, functions, vital };
}
export function structureState(model, saved) {
  if (saved && saved.version !== 1)
    throw Error("Unsupported structural body version");
  const hp = {};
  for (const [id, value] of Object.entries(saved?.hp || {})) {
    const n = model.byId.get(id);
    if (!n || !Number.isFinite(value) || value < 0)
      throw Error("Invalid structural damage");
    if (value < n.hp) hp[id] = Math.min(n.hp, value);
  }
  return { version: 1, hp, revision: 0 };
}
export function boneHealth(model, state, id) {
  const n = model.byId.get(id);
  return n ? (state.hp[id] ?? n.hp) : 0;
}
export function breakBone(model, state, id, amount) {
  const n = model.byId.get(id);
  if (!n || !Number.isFinite(amount) || amount <= 0)
    return { damage: 0, broken: false };
  const before = boneHealth(model, state, id),
    after = Math.max(0, before - amount);
  if (before !== after) {
    state.hp[id] = after;
    state.revision++;
  }
  return { damage: before - after, broken: before > 0 && after === 0 };
}
const evaluated = new WeakMap();
export function evaluateStructure(model, state) {
  const cached = evaluated.get(state);
  if (cached?.revision === state.revision && cached.model === model)
    return cached.value;
  const connected = new Set(),
    queue = [];
  if (boneHealth(model, state, model.root) > 0) {
    connected.add(model.root);
    queue.push(model.root);
  }
  for (let i = 0; i < queue.length; i++)
    for (const id of model.byId.get(queue[i]).links)
      if (!connected.has(id) && boneHealth(model, state, id) > 0) {
        connected.add(id);
        queue.push(id);
      }
  const functions = Object.fromEntries(
    Object.entries(model.functions).map(([key, ids]) => [
      key,
      ids.every((id) => connected.has(id)),
    ]),
  );
  const value = {
    connected,
    functions,
    alive:
      connected.has(model.root) && model.vital.every((id) => connected.has(id)),
    integrity:
      model.nodes.reduce((n, b) => n + boneHealth(model, state, b.id), 0) /
      model.nodes.reduce((n, b) => n + b.hp, 0),
  };
  evaluated.set(state, { revision: state.revision, model, value });
  return value;
}
export function saveStructure(state) {
  return { version: 1, hp: { ...state.hp } };
}
// Slab intersection in the part's local coordinates; returned distance remains
// in world metres when the caller transforms a unit world ray without scaling.
export function rayBox(origin, dir, at, size, max = Infinity) {
  let near = 0,
    far = max;
  for (let i = 0; i < 3; i++) {
    const lo = at[i] - size[i] / 2,
      hi = at[i] + size[i] / 2;
    if (Math.abs(dir[i]) < 1e-10) {
      if (origin[i] < lo || origin[i] > hi) return null;
      continue;
    }
    let a = (lo - origin[i]) / dir[i],
      b = (hi - origin[i]) / dir[i];
    if (a > b) [a, b] = [b, a];
    near = Math.max(near, a);
    far = Math.min(far, b);
    if (near > far) return null;
  }
  return far >= 0.005 && near < max ? Math.max(0.005, near) : null;
}
