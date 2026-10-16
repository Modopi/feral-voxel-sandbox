// 1 world unit = 1 metre. Cell-based rules, bounded work per simulation tick.
export const SIZE = 160,
  HEIGHT = 40,
  CHUNK = 16,
  SEA = 8;
export const B = {
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  SAND: 4,
  WOOD: 5,
  LEAF: 6,
  ORE: 7,
  BASALT: 8,
  LAVA: 9,
  ASH: 10,
  PLANK: 11,
};
export const COLORS = [
  0, 0x729b4c, 0x8b654b, 0x8c9698, 0xd6bc80, 0x805738, 0x4d8147, 0x66bbb4,
  0x424e58, 0xf77b2e, 0x4d4746, 0xc5a071,
];
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export function hash(x, z, s = 0) {
  let n = Math.imul(x ^ s, 374761393) + Math.imul(z, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
function smooth(v) {
  return v * v * (3 - 2 * v);
}
export function noise(x, z, seed) {
  const ix = Math.floor(x),
    iz = Math.floor(z),
    fx = smooth(x - ix),
    fz = smooth(z - iz);
  return (
    (hash(ix, iz, seed) * (1 - fx) + hash(ix + 1, iz, seed) * fx) * (1 - fz) +
    (hash(ix, iz + 1, seed) * (1 - fx) + hash(ix + 1, iz + 1, seed) * fx) * fz
  );
}
export class World {
  constructor(seed = 63026) {
    this.seed = seed;
    this.blocks = new Uint8Array(SIZE * SIZE * HEIGHT);
    this.ground = new Int16Array(SIZE * SIZE);
    this.plants = new Float32Array(SIZE * SIZE);
    this.nutrients = new Float32Array(SIZE * SIZE);
    this.fluids = new Map();
    this.burning = new Map();
    this.edits = new Map();
    this.subcells = new Map();
    this.dirty = new Set();
    this.flowCursor = 0;
    this.ecoCursor = 0;
    this.time = 0;
    this.reactions = {
      burned: 0,
      dissolved: 0,
      basalt: 0,
      steam: 0,
      grazed: 0,
      births: 0,
      deaths: 0,
    };
    this.event = () => {};
    this.rngState = seed;
  }
  random() {
    let t = (this.rngState += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  index(x, y, z) {
    return x + z * SIZE + y * SIZE * SIZE;
  }
  decode(i) {
    const y = (i / (SIZE * SIZE)) | 0,
      q = i - y * SIZE * SIZE;
    return [q % SIZE, y, (q / SIZE) | 0];
  }
  inside(x, y, z) {
    return x >= 0 && z >= 0 && y >= 0 && x < SIZE && z < SIZE && y < HEIGHT;
  }
  get(x, y, z) {
    if (y < 0) return B.BASALT;
    if (!this.inside(x, y, z)) return 0;
    return this.blocks[this.index(x, y, z)];
  }
  set(x, y, z, v, record = true) {
    x |= 0;
    y |= 0;
    z |= 0;
    if (!this.inside(x, y, z) || y === 0) return false;
    const i = this.index(x, y, z);
    if (this.blocks[i] === v && !this.subcells.has(i)) return false;
    this.subcells.delete(i);
    this.blocks[i] = v;
    if (record) this.edits.set(i, v);
    if (v) this.fluids.delete(i);
    this.mark(x, z);
    this.rescan(x, z);
    return true;
  }
  mark(x, z) {
    for (const [dx, dz] of [
      [0, 0],
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ]) {
      const a = (x + dx) >> 4,
        b = (z + dz) >> 4;
      if (a >= 0 && b >= 0 && a < SIZE / CHUNK && b < SIZE / CHUNK)
        this.dirty.add(a + b * (SIZE / CHUNK));
    }
  }
  rescan(x, z) {
    for (let y = HEIGHT - 1; y >= 0; y--)
      if (
        this.get(x, y, z) &&
        this.get(x, y, z) !== B.LEAF &&
        this.get(x, y, z) !== B.WOOD
      ) {
        this.ground[x + z * SIZE] = y;
        return;
      }
  }
  surface(x, z) {
    const xx = clamp(Math.floor(x), 0, SIZE - 1),
      zz = clamp(Math.floor(z), 0, SIZE - 1),
      top = this.ground[xx + zz * SIZE];
    if (!this.subcells.has(this.index(xx, top, zz))) return top + 1;
    const hx = clamp(Math.floor(x * 2), 0, SIZE * 2 - 1),
      hz = clamp(Math.floor(z * 2), 0, SIZE * 2 - 1);
    for (let hy = top * 2 + 1; hy >= 0; hy--) {
      const b = this.getCell(hx, hy, hz);
      if (b && b !== B.WOOD && b !== B.LEAF) return (hy + 1) * 0.5;
    }
    return 0;
  }
  // Only edited one-metre cells allocate eight half-metre children.
  getCell(hx, hy, hz) {
    if (hy < 0) return B.BASALT;
    if (
      hx < 0 ||
      hz < 0 ||
      hx >= SIZE * 2 ||
      hz >= SIZE * 2 ||
      hy >= HEIGHT * 2
    )
      return 0;
    const i = this.index(hx >> 1, hy >> 1, hz >> 1),
      fine = this.subcells.get(i);
    return fine
      ? fine[(hx & 1) + ((hy & 1) << 1) + ((hz & 1) << 2)]
      : this.blocks[i];
  }
  meshCell(x, y, z) {
    if (!this.inside(x, y, z)) return this.get(x, y, z);
    return this.subcells.has(this.index(x, y, z)) ? 0 : this.get(x, y, z);
  }
  setCell(hx, hy, hz, value) {
    if (
      hx < 0 ||
      hz < 0 ||
      hy < 2 ||
      hx >= SIZE * 2 ||
      hz >= SIZE * 2 ||
      hy >= HEIGHT * 2
    )
      return false;
    const x = hx >> 1,
      y = hy >> 1,
      z = hz >> 1,
      i = this.index(x, y, z),
      j = (hx & 1) + ((hy & 1) << 1) + ((hz & 1) << 2);
    let fine = this.subcells.get(i);
    if (!fine) {
      if (this.blocks[i] === value) return false;
      fine = new Uint8Array(8).fill(this.blocks[i]);
      this.subcells.set(i, fine);
    }
    if (fine[j] === value) return false;
    fine[j] = value;
    if (fine.every((v) => v === fine[0])) {
      this.subcells.delete(i);
      this.blocks[i] = fine[0];
    } else this.blocks[i] = fine.find((v) => v !== 0) || 0;
    this.edits.set(i, this.blocks[i]);
    this.fluids.delete(i);
    this.mark(x, z);
    this.rescan(x, z);
    return true;
  }
  miningRegion(hit, size = 1) {
    const n = Math.round(size * 2),
      start =
        n === 1
          ? [hit.hx, hit.hy, hit.hz]
          : [
              Math.floor(hit.hx / 2) * 2 - (n === 4 ? 1 : 0),
              Math.floor(hit.hy / 2) * 2 - (n === 4 ? 1 : 0),
              Math.floor(hit.hz / 2) * 2 - (n === 4 ? 1 : 0),
            ];
    return { start, n, size };
  }
  mine(hit, size = 1) {
    const r = this.miningRegion(hit, size),
      counts = new Map();
    let removed = 0;
    for (let dz = 0; dz < r.n; dz++)
      for (let dy = 0; dy < r.n; dy++)
        for (let dx = 0; dx < r.n; dx++) {
          const x = r.start[0] + dx,
            y = r.start[1] + dy,
            z = r.start[2] + dz,
            b = this.getCell(x, y, z);
          if (!b || b === B.LAVA || y < 2) continue;
          if (this.setCell(x, y, z, 0)) {
            counts.set(b, (counts.get(b) || 0) + 1);
            removed++;
          }
        }
    return { removed, counts, region: r };
  }
  placeCells(start, size, material) {
    const n = Math.round(size * 2);
    for (let z = 0; z < n; z++)
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          const hx = start[0] + x,
            hy = start[1] + y,
            hz = start[2] + z;
          if (
            hx < 0 ||
            hz < 0 ||
            hy < 2 ||
            hx >= SIZE * 2 ||
            hz >= SIZE * 2 ||
            hy >= HEIGHT * 2 ||
            this.getCell(hx, hy, hz)
          )
            return false;
        }
    for (let z = 0; z < n; z++)
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++)
          this.setCell(start[0] + x, start[1] + y, start[2] + z, material);
    return true;
  }
  raycast(origin, dir, max = 7) {
    const o = [origin.x, origin.y, origin.z],
      d = [dir.x, dir.y, dir.z],
      cell = o.map((v) => Math.floor(v * 2)),
      step = d.map((v) => (v >= 0 ? 1 : -1)),
      tDelta = d.map((v) => (v ? Math.abs(0.5 / v) : Infinity)),
      tMax = d.map((v, k) =>
        v ? ((cell[k] + (v >= 0 ? 1 : 0)) * 0.5 - o[k]) / v : Infinity,
      );
    let t = 0,
      normal = [0, 0, 0];
    for (let iter = 0; iter < 160 && t <= max; iter++) {
      const b = this.getCell(...cell);
      if (b)
        return {
          x: cell[0] >> 1,
          y: cell[1] >> 1,
          z: cell[2] >> 1,
          hx: cell[0],
          hy: cell[1],
          hz: cell[2],
          b,
          distance: t,
          point: o.map((v, k) => v + d[k] * t),
          normal,
        };
      let axis = tMax[0] < tMax[1] ? 0 : 1;
      if (tMax[2] < tMax[axis]) axis = 2;
      t = tMax[axis];
      cell[axis] += step[axis];
      tMax[axis] += tDelta[axis];
      normal = [0, 0, 0];
      normal[axis] = -step[axis];
    }
    return null;
  }
  generate() {
    for (let z = 0; z < SIZE; z++)
      for (let x = 0; x < SIZE; x++) {
        const river = 96 + Math.sin(z * 0.042) * 12;
        const rd = Math.abs(x - river);
        const n = noise(x / 43, z / 43, this.seed),
          n2 = noise(x / 15, z / 15, this.seed + 3);
        let h = Math.floor(
          8 + n * 10 + n2 * 3 + Math.max(0, (x - 115) / 15) * 2,
        );
        if (rd < 8) h = Math.floor(5 + rd * 0.42);
        else if (rd < 15) h = Math.min(h, Math.floor(8 + (rd - 8) * 0.55));
        const arid = x > 125 && z < 90;
        h = clamp(h, 3, 27);
        this.ground[x + z * SIZE] = h;
        this.plants[x + z * SIZE] = arid ? 0.08 : 0.45 + hash(x, z) * 0.55;
        this.nutrients[x + z * SIZE] = 0.5;
        for (let y = 0; y <= h; y++) {
          let b =
            y === h
              ? h < SEA + 1 || arid
                ? B.SAND
                : B.GRASS
              : y > h - 3
                ? B.DIRT
                : B.STONE;
          if (y === 0) b = B.BASALT;
          if (y < h - 3 && hash(x + y * 37, z, this.seed) > 0.99) b = B.ORE;
          this.blocks[this.index(x, y, z)] = b;
        }
        for (let y = h + 1; y < SEA + 1; y++)
          this.fluids.set(this.index(x, y, z), { v: 1, a: 0 });
      }
    // Sparse voxel trees, each block remains individually editable and combustible.
    for (let z = 5; z < SIZE - 5; z++)
      for (let x = 5; x < SIZE - 5; x++)
        if (
          x < 125 &&
          Math.hypot(x - 77, z - 84) > 11 &&
          hash(x, z, this.seed + 87) > 0.992 &&
          this.ground[x + z * SIZE] > SEA + 2
        ) {
          let y = this.surface(x, z),
            h = 3 + Math.floor(hash(z, x) * 3);
          for (let j = 0; j < h; j++)
            this.blocks[this.index(x, y + j, z)] = B.WOOD;
          for (let dz = -2; dz <= 2; dz++)
            for (let dx = -2; dx <= 2; dx++)
              for (let dy = -1; dy <= 1; dy++)
                if (
                  Math.abs(dx) + Math.abs(dz) + Math.abs(dy) < 5 &&
                  this.inside(x + dx, y + h + dy, z + dz) &&
                  !this.get(x + dx, y + h + dy, z + dz)
                )
                  this.blocks[this.index(x + dx, y + h + dy, z + dz)] = B.LEAF;
        }
    // Flat, clear landing patch with a safe two-block head space.
    const landing = this.ground[77 + 84 * SIZE];
    for (let z = 78; z <= 90; z++)
      for (let x = 71; x <= 81; x++) {
        for (let y = 1; y < HEIGHT; y++)
          this.blocks[this.index(x, y, z)] =
            y < landing - 2
              ? B.STONE
              : y < landing
                ? B.DIRT
                : y === landing
                  ? B.GRASS
                  : B.AIR;
        this.ground[x + z * SIZE] = landing;
        for (let y = landing + 1; y < HEIGHT; y++)
          this.fluids.delete(this.index(x, y, z));
      }
    // A half-metre stair path links the open landing to the river bank.
    for (let x = 80; x <= 86; x++)
      for (let z = 82; z <= 86; z++) {
        const top = landing + 1 - (x - 80) * 0.5,
          full = Math.floor(top);
        for (let y = 1; y < HEIGHT; y++)
          this.blocks[this.index(x, y, z)] =
            y < full ? (y === full - 1 ? B.GRASS : B.DIRT) : 0;
        this.ground[x + z * SIZE] = full - 1;
        for (let y = full; y < HEIGHT; y++)
          this.fluids.delete(this.index(x, y, z));
        if (top !== full)
          for (let dx = 0; dx < 2; dx++)
            for (let dz = 0; dz < 2; dz++)
              this.setCell(x * 2 + dx, full * 2, z * 2 + dz, B.GRASS);
      }
    for (let z = 83; z <= 86; z++)
      for (let x = 76; x <= 77; x++)
        this.blocks[this.index(x, landing, z)] = B.PLANK;
    // Ruin / volcanic test site; no continuous source creates free fluid mass.
    this.landmarks = [
      { x: 77, z: 81, name: "초록 능선" },
      { x: 102, z: 55, name: "굽이치는 강" },
      { x: 140, z: 35, name: "잿빛 분화구" },
      { x: 35, z: 45, name: "이끼 숲" },
      { x: 48, z: 120, name: "잊힌 관측소" },
    ];
    for (let x = 136; x <= 143; x++)
      for (let z = 31; z <= 38; z++) {
        let h = this.surface(x, z) - 1;
        this.blocks[this.index(x, h, z)] =
          x > 137 && x < 142 && z > 32 && z < 37 ? B.LAVA : B.BASALT;
        this.plants[x + z * SIZE] = 0;
      }
    for (let x = 44; x < 53; x++)
      for (let z = 116; z < 125; z++)
        if (x === 44 || x === 52 || z === 116 || z === 124)
          for (let d = 0; d < 2 + ((hash(x, z) * 3) | 0); d++)
            this.blocks[this.index(x, this.surface(x, z) + d, z)] = B.BASALT;
    this.dirty.clear();
    for (let i = 0; i < 100; i++) this.dirty.add(i);
  }
  pour(x, y, z, amount = 4, acid = 0) {
    x |= 0;
    y |= 0;
    z |= 0;
    let left = amount;
    for (let k = 0; k < 10 && left > 0.001; k++) {
      let yy = y + ((k / 5) | 0),
        xx = x + (k % 5 === 1 ? 1 : k % 5 === 2 ? -1 : 0),
        zz = z + (k % 5 === 3 ? 1 : k % 5 === 4 ? -1 : 0);
      if (!this.inside(xx, yy, zz) || this.get(xx, yy, zz)) continue;
      const i = this.index(xx, yy, zz),
        f = this.fluids.get(i) || { v: 0, a: 0 },
        add = Math.min(left, 1 - f.v);
      f.v += add;
      f.a += add * acid;
      left -= add;
      this.fluids.set(i, f);
    }
    return amount - left;
  }
  ignite(x, y, z) {
    if (!this.inside(x, y, z)) return;
    const i = this.index(x, y, z),
      b = this.get(x, y, z);
    if ([B.GRASS, B.WOOD, B.LEAF, B.PLANK].includes(b) && !this.burning.has(i))
      this.burning.set(i, { life: b === B.WOOD ? 8 : b === B.LEAF ? 3 : 4 });
  }
  fluidStep(budget = 360) {
    const keys = Array.from(this.fluids.keys());
    if (!keys.length) return;
    const count = Math.min(budget, keys.length);
    for (let k = 0; k < count; k++) {
      const i = keys[(this.flowCursor + k) % keys.length],
        f = this.fluids.get(i);
      if (!f || f.v < 0.00005) {
        this.fluids.delete(i);
        continue;
      }
      const [x, y, z] = this.decode(i);
      const transfer = (xx, yy, zz, desired) => {
        if (!this.inside(xx, yy, zz) || yy === 0) return;
        if (this.get(xx, yy, zz)) return;
        const j = this.index(xx, yy, zz),
          g = this.fluids.get(j) || { v: 0, a: 0 },
          m = Math.min(f.v, 1 - g.v, Math.max(0, desired));
        if (m < 0.00005) return;
        const a = (f.a / f.v) * m;
        f.v -= m;
        f.a -= a;
        g.v += m;
        g.a += a;
        this.fluids.set(j, g);
      };
      transfer(x, y - 1, z, f.v);
      if (f.v > 0.005) {
        const dirs = [
            [1, 0],
            [0, 1],
            [-1, 0],
            [0, -1],
          ],
          off = ((this.time * 10) | 0) % 4;
        for (let d = 0; d < 4; d++) {
          const [dx, dz] = dirs[(d + off) % 4],
            g = this.fluids.get(this.index(x + dx, y, z + dz));
          transfer(x + dx, y, z + dz, (f.v - (g?.v || 0)) * 0.23);
        }
      }
      for (const [dx, dy, dz] of [
        [0, -1, 0],
        [1, 0, 0],
        [-1, 0, 0],
        [0, 0, 1],
        [0, 0, -1],
      ]) {
        const xx = x + dx,
          yy = y + dy,
          zz = z + dz,
          j = this.index(xx, yy, zz),
          b = this.get(xx, yy, zz);
        if (!this.inside(xx, yy, zz)) continue;
        if (b === B.LAVA && f.v > 0.15) {
          this.set(xx, yy, zz, B.BASALT);
          const used = Math.min(0.2, f.v),
            ratio = f.a / f.v;
          f.v -= used;
          f.a -= used * ratio;
          this.reactions.basalt++;
          this.reactions.steam += used;
          this.event("물 + 용암 → 현무암 · 수증기", [x, y, z]);
        }
        if (f.v > 0.08) {
          this.burning.delete(j);
          this.plants[xx + zz * SIZE] = Math.max(
            0,
            this.plants[xx + zz * SIZE] - (f.a / f.v) * 0.05,
          );
        }
        if (
          f.a > 0.04 &&
          f.a / f.v > 0.3 &&
          [B.DIRT, B.GRASS, B.WOOD, B.LEAF, B.PLANK].includes(b) &&
          this.random() < 0.025
        ) {
          this.set(xx, yy, zz, B.AIR);
          f.a = Math.max(0, f.a - 0.04);
          this.reactions.dissolved++;
        }
      }
      if (f.v < 0.00005) this.fluids.delete(i);
    }
    this.flowCursor = (this.flowCursor + count) % Math.max(1, keys.length);
  }
  chemistryStep(dt) {
    for (const [i, f] of Array.from(this.burning.entries()).slice(0, 250)) {
      const [x, y, z] = this.decode(i);
      const water = this.fluids.get(this.index(x, y + 1, z));
      if (water?.v > 0.05) {
        this.burning.delete(i);
        continue;
      }
      f.life -= dt;
      this.plants[x + z * SIZE] = 0;
      if (this.random() < dt * 0.5) {
        const dirs = [
            [1, 0, 0],
            [-1, 0, 0],
            [0, 1, 0],
            [0, 0, 1],
            [0, 0, -1],
          ],
          d = dirs[(this.random() * 5) | 0];
        this.ignite(x + d[0], y + d[1], z + d[2]);
      }
      if (f.life <= 0) {
        const b = this.get(x, y, z);
        this.set(x, y, z, b === B.GRASS ? B.ASH : B.AIR);
        this.burning.delete(i);
        this.nutrients[x + z * SIZE] = Math.min(
          1,
          this.nutrients[x + z * SIZE] + 0.2,
        );
        this.reactions.burned++;
      }
    }
  }
  ecosystemStep(dt) {
    const count = 320;
    for (let k = 0; k < count; k++) {
      const i = this.ecoCursor++ % (SIZE * SIZE),
        x = i % SIZE,
        z = (i / SIZE) | 0,
        h = this.ground[i],
        b = this.get(x, h, z),
        f = this.fluids.get(this.index(x, h + 1, z));
      if (b === B.GRASS || b === B.ASH) {
        const wet =
          Math.abs(x - (96 + Math.sin(z * 0.042) * 12)) < 19 ? 0.8 : 0.35;
        this.plants[i] = clamp(
          this.plants[i] +
            dt *
              80 *
              0.0015 *
              (wet + this.nutrients[i]) *
              (1 - this.plants[i]) -
            (f?.a || 0) * 0.01,
          0,
          1,
        );
        if (b === B.ASH && this.plants[i] > 0.45) this.set(x, h, z, B.GRASS);
      }
    }
  }
  totalFluid() {
    let v = 0,
      a = 0;
    for (const f of this.fluids.values()) {
      v += f.v;
      a += f.a;
    }
    return { water: v, acid: a };
  }
  save() {
    return {
      seed: this.seed,
      time: this.time,
      rngState: this.rngState,
      edits: [...this.edits],
      subcells: [...this.subcells].map(([i, v]) => [i, Array.from(v)]),
      fluids: [...this.fluids].map(([i, f]) => [
        i,
        +f.v.toFixed(5),
        +f.a.toFixed(5),
      ]),
      burning: [...this.burning],
      plants: Array.from(this.plants).map((v) => +v.toFixed(3)),
      nutrients: Array.from(this.nutrients).map((v) => +v.toFixed(3)),
      reactions: this.reactions,
    };
  }
  load(s) {
    this.time = s.time || 0;
    this.rngState = s.rngState || this.seed;
    for (const [i, v] of s.edits || []) {
      const [x, y, z] = this.decode(i);
      this.set(x, y, z, v);
    }
    for (const [i, values] of s.subcells || []) {
      if (Array.isArray(values) && values.length === 8) {
        this.subcells.set(i, new Uint8Array(values));
        const [x, y, z] = this.decode(i);
        this.mark(x, z);
        this.rescan(x, z);
      }
    }
    if (s.fluids)
      this.fluids = new Map(s.fluids.map(([i, v, a]) => [i, { v, a }]));
    this.burning = new Map(s.burning || []);
    if (s.plants) this.plants.set(s.plants);
    if (s.nutrients) this.nutrients.set(s.nutrients);
    Object.assign(this.reactions, s.reactions);
  }
}
