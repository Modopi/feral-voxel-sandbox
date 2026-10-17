import { FACES, cellKey, components } from "./structure.js";
import { rotate } from "./machine/assembly-state.js";
import { rayBox } from "./structural-body.js";

// Half-metre cells keep their material, damage and identity when terrain becomes a body.
export const DENSITY = [
  0, 1400, 1400, 2400, 1600, 600, 80, 2800, 2800, 0, 600, 500,
];
export const voxelMass = (b) => (DENSITY[b] || 1000) / 8;
const vector = () => ({ x: 0, y: 0, z: 0 });
const point = (c) => ({ x: c.x * 0.5, y: c.y * 0.5, z: c.z * 0.5 });
const solid = (b) => b > 0 && b !== 9;
const spatialCache = new WeakMap();
function spatial(body) {
  let cached = spatialCache.get(body);
  if (cached?.revision === body.revision) return cached;
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity],
    cells = new Map();
  for (const c of body.cells) {
    const p = [c.x, c.y, c.z];
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], p[i] * 0.5 - 0.25);
      max[i] = Math.max(max[i], p[i] * 0.5 + 0.25);
    }
    cells.set(cellKey(c.x, c.y, c.z), c);
  }
  cached = {
    revision: body.revision,
    cells,
    at: min.map((v, i) => (v + max[i]) / 2),
    size: min.map((v, i) => max[i] - v),
  };
  spatialCache.set(body, cached);
  return cached;
}
export function massCenter(cells) {
  const center = vector();
  let mass = 0;
  for (const c of cells) {
    const m = voxelMass(c.b);
    mass += m;
    for (const k of ["x", "y", "z"]) center[k] += c[k] * 0.5 * m;
  }
  for (const k of ["x", "y", "z"]) center[k] /= mass || 1;
  return { mass, center };
}
// Merge same-material solid runs into compound cuboids. No collider per rendered face.
export function colliderBoxes(cells) {
  const left = new Map(cells.map((c) => [cellKey(c.x, c.y, c.z), c.b])),
    boxes = [];
  for (const c of cells) {
    if (!left.has(cellKey(c.x, c.y, c.z))) continue;
    let nx = 1,
      ny = 1,
      nz = 1;
    const matches = (dx, dy, dz) =>
      left.get(cellKey(c.x + dx, c.y + dy, c.z + dz)) === c.b;
    while (matches(nx, 0, 0)) nx++;
    nextY: while (true) {
      for (let x = 0; x < nx; x++) if (!matches(x, ny, 0)) break nextY;
      ny++;
    }
    nextZ: while (true) {
      for (let y = 0; y < ny; y++)
        for (let x = 0; x < nx; x++) if (!matches(x, y, nz)) break nextZ;
      nz++;
    }
    for (let z = 0; z < nz; z++)
      for (let y = 0; y < ny; y++)
        for (let x = 0; x < nx; x++)
          left.delete(cellKey(c.x + x, c.y + y, c.z + z));
    boxes.push({
      at: {
        x: c.x * 0.5 + (nx - 1) * 0.25,
        y: c.y * 0.5 + (ny - 1) * 0.25,
        z: c.z * 0.5 + (nz - 1) * 0.25,
      },
      half: { x: nx * 0.25, y: ny * 0.25, z: nz * 0.25 },
      mass: voxelMass(c.b) * nx * ny * nz,
    });
  }
  return boxes;
}
export class LooseVoxels {
  constructor(world) {
    this.world = world;
    this.enabled = false;
    this.mutating = false;
    this.bodies = [];
    this.nextId = 1;
    this.pending = new Set();
    this.grounded = new Set();
  }
  changed(x, y, z, n = 1) {
    if (!this.enabled || this.mutating) return;
    for (let dz = 0; dz < n; dz++)
      for (let dy = 0; dy < n; dy++)
        for (let dx = 0; dx < n; dx++) {
          const at = [x + dx, y + dy, z + dz];
          this.pending.add(cellKey(...at));
          for (const d of FACES)
            this.pending.add(cellKey(...at.map((v, k) => v + d[k])));
        }
  }
  tick(budget = 2048) {
    if (!this.enabled) return;
    const w = this.world;
    if (this.epoch !== w.collisionRevision) {
      if (this.job) this.pending.add(this.job.start);
      this.job = null;
      this.grounded.clear();
      this.epoch = w.collisionRevision;
    }
    // Depth first, downward first: terrain reaches bedrock quickly; suspended islands are fully traversed.
    const directions = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 0, 1],
      [0, 0, -1],
      [0, 1, 0],
      [0, -1, 0],
    ];
    while (budget-- > 0) {
      if (!this.job) {
        const start = this.pending.values().next().value;
        if (start === undefined) return;
        this.pending.delete(start);
        const p = start.split(",").map(Number);
        if (this.grounded.has(start) || !solid(w.getCell(...p)) || p[1] < 2)
          continue;
        this.job = { start, stack: [p], seen: new Set([start]), cells: [] };
      }
      const job = this.job,
        p = job.stack.pop(),
        key = cellKey(...p);
      job.cells.push({
        x: p[0],
        y: p[1],
        z: p[2],
        b: w.getCell(...p),
        damage: w.miningDamage.get(w.damageKey(...p))?.[1] || 0,
      });
      if (p[1] <= 2 || this.grounded.has(key)) {
        // Only visited cells are proven connected; all queued neighbours are connected too.
        for (const k of job.seen) {
          this.grounded.add(k);
          this.pending.delete(k);
        }
        this.job = null;
        continue;
      }
      for (const d of directions) {
        const q = p.map((v, k) => v + d[k]),
          k = cellKey(...q);
        if (!job.seen.has(k) && solid(w.getCell(...q))) {
          job.seen.add(k);
          job.stack.push(q);
        }
      }
      if (job.stack.length) continue;
      this.mutating = true;
      try {
        for (const c of job.cells) {
          w.setCell(c.x, c.y, c.z, 0);
          this.pending.delete(cellKey(c.x, c.y, c.z));
        }
      } finally {
        this.mutating = false;
      }
      const min = { x: Infinity, y: Infinity, z: Infinity };
      for (const c of job.cells)
        for (const k of ["x", "y", "z"]) min[k] = Math.min(min[k], c[k]);
      const cells = job.cells.map((c) => ({
        ...c,
        x: c.x - min.x,
        y: c.y - min.y,
        z: c.z - min.z,
      }));
      this.create(cells, {
        x: min.x * 0.5 + 0.25,
        y: min.y * 0.5 + 0.25,
        z: min.z * 0.5 + 0.25,
      });
      this.epoch = w.collisionRevision;
      this.job = null;
    }
  }
  create(cells, position, pose = {}) {
    const body = {
      id: this.nextId++,
      cells,
      revision: 0,
      pose: {
        position: { ...position },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        velocity: vector(),
        spin: vector(),
        anchored: false,
        ...structuredClone(pose),
      },
    };
    this.bodies.push(body);
    return body;
  }
  raycast(origin, direction, max = 6.5) {
    let nearest = null;
    for (const body of this.bodies) {
      const q = body.pose.rotation,
        inv = { x: -q.x, y: -q.y, z: -q.z, w: q.w };
      const o = rotate(inv, {
          x: origin.x - body.pose.position.x,
          y: origin.y - body.pose.position.y,
          z: origin.z - body.pose.position.z,
        }),
        d = rotate(inv, direction);
      const grid = spatial(body),
        oa = [o.x, o.y, o.z],
        da = [d.x, d.y, d.z],
        limit = nearest?.distance ?? max;
      const enter = rayBox(oa, da, grid.at, grid.size, limit);
      if (enter === null) continue;
      const voxel = oa.map((v, i) =>
          Math.floor((v + da[i] * (enter + 1e-6) + 0.25) * 2),
        ),
        steps = da.map((v) => (v >= 0 ? 1 : -1));
      const delta = da.map((v) => (v ? Math.abs(0.5 / v) : Infinity)),
        next = da.map((v, i) =>
          v
            ? ((voxel[i] + (v >= 0 ? 1 : 0)) * 0.5 - 0.25 - oa[i]) / v
            : Infinity,
        );
      const candidates = [];
      let atDistance = enter;
      for (
        let iter = 0;
        iter < Math.ceil(limit * 7) + 6 && atDistance <= limit;
        iter++
      ) {
        const c = grid.cells.get(cellKey(...voxel));
        if (c) {
          candidates.push(c);
          break;
        }
        let axis = 0;
        for (let i = 1; i < 3; i++) if (next[i] < next[axis]) axis = i;
        atDistance = next[axis];
        next[axis] += delta[axis];
        voxel[axis] += steps[axis];
      }
      for (const cell of candidates) {
        const at = point(cell),
          t = rayBox(
            [o.x, o.y, o.z],
            [d.x, d.y, d.z],
            [at.x, at.y, at.z],
            [0.5, 0.5, 0.5],
            nearest?.distance ?? max,
          );
        if (t === null || t < 0 || t > (nearest?.distance ?? max)) continue;
        const local = { x: o.x + d.x * t, y: o.y + d.y * t, z: o.z + d.z * t },
          normal = [0, 0, 0];
        const axes = ["x", "y", "z"],
          delta = axes.map((k) => local[k] - at[k]);
        let axis = 0;
        for (let i = 1; i < 3; i++)
          if (Math.abs(delta[i]) > Math.abs(delta[axis])) axis = i;
        normal[axis] = Math.sign(delta[axis]) || 1;
        nearest = {
          kind: "loose",
          body,
          cell,
          local,
          normal,
          distance: t,
          point: [
            origin.x + direction.x * t,
            origin.y + direction.y * t,
            origin.z + direction.z * t,
          ],
        };
      }
    }
    return nearest;
  }
  strike(hit, amount) {
    const { body, cell } = hit;
    if (
      !this.bodies.includes(body) ||
      !body.cells.includes(cell) ||
      !(amount > 0) ||
      !Number.isFinite(amount)
    )
      return false;
    cell.damage = (cell.damage || 0) + amount;
    if (cell.damage < 1 - 1e-9) return false;
    const before = massCenter(body.cells).center;
    body.cells = body.cells.filter((c) => c !== cell);
    body.revision++;
    const groups = components(body.cells).sort((a, b) => b.length - a.length);
    if (!groups.length) this.bodies.splice(this.bodies.indexOf(body), 1);
    else {
      const old = structuredClone(body.pose);
      groups.forEach((cells, i) => {
        const next = i === 0 ? body : this.create(cells, old.position, old);
        next.cells = cells;
        // Rigid bodies store velocity at centre of mass, not at their modelling origin.
        const center = massCenter(cells).center,
          shift = rotate(old.rotation, {
            x: center.x - before.x,
            y: center.y - before.y,
            z: center.z - before.z,
          }),
          a = old.spin;
        next.pose.velocity = {
          x: old.velocity.x + a.y * shift.z - a.z * shift.y,
          y: old.velocity.y + a.z * shift.x - a.x * shift.z,
          z: old.velocity.z + a.x * shift.y - a.y * shift.x,
        };
        // A pin only retains the original component. Newly severed pieces are free.
        if (i) next.pose.anchored = false;
      });
    }
    return true;
  }
  add(hit, b) {
    if (!solid(b) || !this.bodies.includes(hit.body)) return false;
    const c = {
      x: hit.cell.x + hit.normal[0],
      y: hit.cell.y + hit.normal[1],
      z: hit.cell.z + hit.normal[2],
      b,
    };
    if (hit.body.cells.some((p) => p.x === c.x && p.y === c.y && p.z === c.z))
      return false;
    hit.body.cells.push(c);
    hit.body.revision++;
    return true;
  }
  save() {
    return {
      version: 1,
      nextId: this.nextId,
      bodies: structuredClone(this.bodies),
      pending: [...this.pending, ...(this.job ? [this.job.start] : [])],
    };
  }
  load(saved) {
    this.bodies = [];
    this.pending.clear();
    this.job = null;
    this.grounded.clear();
    if (!saved) return;
    if (saved.version !== 1 || !Array.isArray(saved.bodies))
      throw new Error("분리 복셀 저장 형식 오류");
    const ids = new Set();
    for (const body of saved.bodies) {
      if (
        !Number.isSafeInteger(body.id) ||
        body.id < 1 ||
        ids.has(body.id) ||
        !Array.isArray(body.cells) ||
        !body.cells.length
      )
        throw new Error("분리 물체 식별자 오류");
      ids.add(body.id);
      const keys = new Set();
      for (const c of body.cells) {
        const key = cellKey(c.x, c.y, c.z);
        if (
          ![c.x, c.y, c.z].every(
            (v) => Number.isInteger(v) && Math.abs(v) < 640,
          ) ||
          !Number.isInteger(c.b) ||
          c.b < 1 ||
          c.b > 11 ||
          c.b === 9 ||
          keys.has(key) ||
          (c.damage !== undefined &&
            (!Number.isFinite(c.damage) || c.damage < 0 || c.damage >= 1))
        )
          throw new Error("분리 복셀 데이터 오류");
        keys.add(key);
      }
      for (const k of ["position", "velocity", "spin", "rotation"])
        for (const a of k === "rotation"
          ? ["x", "y", "z", "w"]
          : ["x", "y", "z"])
          if (!Number.isFinite(body.pose?.[k]?.[a]))
            throw new Error("분리 물체 위치 오류");
      if (
        typeof body.pose.anchored !== "boolean" ||
        Object.values(body.pose.position).some((v) => Math.abs(v) > 500) ||
        [
          ...Object.values(body.pose.velocity),
          ...Object.values(body.pose.spin),
        ].some((v) => Math.abs(v) > 300)
      )
        throw new Error("분리 물체 위치 범위 오류");
      const q = body.pose.rotation,
        length = Math.hypot(q.x, q.y, q.z, q.w);
      if (length < 0.99 || length > 1.01)
        throw new Error("분리 물체 회전 오류");
      this.bodies.push({ ...structuredClone(body), revision: 0 });
    }
    this.nextId = Math.max(
      1,
      Number.isSafeInteger(saved.nextId) && saved.nextId > 0 ? saved.nextId : 1,
      ...[...ids].map((id) => id + 1),
    );
    for (const key of saved.pending || []) {
      if (typeof key !== "string") continue;
      const p = key.split(",").map(Number);
      if (
        p.length === 3 &&
        p.every(Number.isInteger) &&
        p[0] >= 0 &&
        p[0] < 320 &&
        p[1] >= 2 &&
        p[1] < 80 &&
        p[2] >= 0 &&
        p[2] < 320
      )
        this.pending.add(key);
    }
  }
}
