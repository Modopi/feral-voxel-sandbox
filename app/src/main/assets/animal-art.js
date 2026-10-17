// Original coats and silhouette pieces on a 1/32 m art grid. Damage still uses the
// saved anatomical cells; every visible piece belongs to one of those cells.
const cache = new Map(),
  P = 1 / 32;
export function animalColor(type, part, index, p) {
  const y = Math.floor(index / p.dims[0]) % p.dims[1];
  if (type === 2)
    return part === 0
      ? y
        ? 0x356d85
        : 0x294853
      : part === 1
        ? 0x518c96
        : part < 6
          ? 0x304853
          : 0x9aaf88;
  if (type === 1)
    return part === 0
      ? y
        ? 0xb76e42
        : 0xd7ad78
      : part === 1
        ? y
          ? 0xc0804c
          : 0xe2c497
        : part < 6
          ? y
            ? 0x82543d
            : 0x3f3633
          : part === 6
            ? 0xc28a54
            : 0x624637;
  return part === 0
    ? y
      ? 0x65836a
      : 0xa9b18b
    : part === 1
      ? y
        ? 0x8d9d78
        : 0xc6c4a1
      : part < 6
        ? y
          ? 0x7e8866
          : 0x434e42
        : part === 6
          ? 0x9eaa7e
          : 0x8d9d78;
}
export function animalDetails(type, parts) {
  if (cache.has(type)) return cache.get(type);
  const pieces = [];
  const add = (part, at, size, color, feature = "coat", micro = false) => {
    const p = parts[part],
      center = at.map((v) => v * P),
      extent = size.map((v) => v * P);
    // Split broad surface patches at physical cell boundaries so a wound never
    // leaves a full shell/belly panel floating over removed voxels.
    const cuts = center.map((c, axis) => {
      const min = c - extent[axis] / 2,
        max = c + extent[axis] / 2,
        a = [min];
      const start =
        -(p.leg && axis === 1 ? p.dims[axis] : p.dims[axis] / 2) * p.cell;
      for (let k = 1; k < p.dims[axis]; k++) {
        const edge = start + k * p.cell;
        if (edge > min + 0.0001 && edge < max - 0.0001) a.push(edge);
      }
      a.push(max);
      return a;
    });
    for (let x = 0; x < cuts[0].length - 1; x++)
      for (let y = 0; y < cuts[1].length - 1; y++)
        for (let z = 0; z < cuts[2].length - 1; z++) {
          const indices = [x, y, z],
            c = cuts.map((a, i) => (a[indices[i]] + a[indices[i] + 1]) / 2),
            s = cuts.map((a, i) => a[indices[i] + 1] - a[indices[i]]);
          const owner = c.map((v, i) =>
            Math.max(
              0,
              Math.min(
                p.dims[i] - 1,
                Math.floor(
                  v / p.cell + (p.leg && i === 1 ? p.dims[i] : p.dims[i] / 2),
                ),
              ),
            ),
          );
          pieces.push({
            part,
            voxel:
              owner[0] +
              owner[1] * p.dims[0] +
              owner[2] * p.dims[0] * p.dims[1],
            at: c,
            size: s,
            color,
            feature,
            micro,
          });
        }
  };
  if (type < 2) {
    // Stepped muzzle, dark nose, recessed mouth, lateral eyes and small highlights.
    add(1, [0, -3, -9], [10, 6, 4], type === 0 ? 0xd1ccb0 : 0xe7cda1, "muzzle");
    add(1, [0, -2, -11.5], [5, 3, 2], 0x333e37, "nose");
    add(1, [0, -5.5, -10], [6, 1, 3], 0x6d6550, "mouth", true);
    for (const s of [-1, 1]) {
      add(1, [s * 7, 2, -7.8], [3, 3, 1], 0xede2bf, "eye");
      add(1, [s * 7, 2, -8.5], [2, 2, 1], 0x213637, "pupil");
      add(1, [s * 7.5, 3, -9], [1, 1, 1], 0xe5ecd7, "glint", true);
      add(1, [s * 8, 2, -5], [1, 3, 4], 0x3c4d3e, "eye");
    }
    for (let pi = 2; pi < 6; pi++)
      add(
        pi,
        [0, -14, 0],
        [8.2, 4, 8.2],
        type === 0 ? 0x3c463a : 0x393330,
        "hoof",
      );
  }
  if (type === 0) {
    for (const s of [-1, 1]) {
      // Ear blades and branched antlers are rooted in the top head cells.
      add(s < 0 ? 7 : 8, [s * 1, 1, 0], [6, 7, 2], 0x91a27a, "ear");
      add(s < 0 ? 7 : 8, [s * 1, 1, -1.3], [3, 4, 1], 0xd9c9a0, "ear", true);
      add(1, [s * 5, 13, 1], [2, 12, 2], 0x8d7956, "antler");
      add(1, [s * 7, 17, 1], [6, 2, 2], 0xb5a17c, "antler");
      add(1, [s * 9, 20, 1], [2, 6, 2], 0xcac09b, "antler");
      add(1, [s * 5, 18, -2], [2, 2, 6], 0xb5a17c, "antler");
      add(1, [s * 5, 20, -4], [2, 4, 2], 0xd0c29b, "antler");
      for (const [z, y] of [
        [-10, 2],
        [-3, 4],
        [4, 1],
        [10, 3],
      ])
        add(0, [s * 16.2, y, z], [1, 2, 3], 0xc8c7a0, "spot", true);
      add(0, [s * 10, 8.2, -4], [8, 1, 8], 0x4c7058, "moss");
      add(0, [s * 11, 9.2, -5], [3, 1, 4], 0x8b9e69, "moss", true);
    }
    add(0, [0, -8.2, -4], [18, 1, 23], 0xd1c9a4, "belly");
    add(6, [0, 0, 6], [6, 6, 6], 0xd6cfaa, "tail");
  } else if (type === 1) {
    for (const s of [-1, 1]) {
      const pi = s < 0 ? 7 : 8;
      add(pi, [0, 0, 0], [7, 8, 5], 0xa46542, "ear");
      add(pi, [0, 5, 0], [4, 4, 4], 0x4d3933, "ear");
      add(pi, [0, 0, -2.8], [3, 5, 1], 0xdba67f, "ear", true);
      add(1, [s * 8, -3, -5], [3, 5, 8], 0xe7cda1, "cheek");
      add(0, [s * 8, 8.2, 0], [6, 1, 22], 0x985737, "coat");
    }
    add(0, [0, -3, -16.2], [20, 9, 1], 0xe5c99b, "chest");
    add(6, [0, 0, 1], [11, 10, 13], 0xbc7a48, "tail");
    add(6, [0, 1, 9], [9, 8, 5], 0xead6af, "tail");
    add(6, [0, 1, 12], [5, 5, 2], 0xf0dfbd, "tail");
  } else {
    for (const s of [-1, 1]) {
      add(0, [s * 4, 4.5, 0], [7, 3, 18], s < 0 ? 0x457f99 : 0x508da1, "wing");
      add(0, [s * 4, 6.2, -1], [4, 1, 14], 0x71b7b5, "wing");
      for (const z of [-5, 1, 7])
        add(0, [s * 4, 6.8, z], [6, 1, 1], 0xb7be7d, "ridge", true);
      add(1, [s * 3, 1, -4.3], [2, 3, 1], 0x192f3a, "eye");
      add(1, [s * 3, 2, -5], [1, 1, 1], 0xdbe7c1, "glint", true);
      add(1, [s * 2, -3, -5.5], [2, 2, 4], 0xc3b983, "mandible");
      const pi = s < 0 ? 7 : 8;
      add(pi, [s * 1, 2, -1], [2, 5, 2], 0x637e73, "antenna");
      add(pi, [s * 2, 4, -3], [2, 2, 5], 0xa3bf92, "antenna");
      add(pi, [s * 2, 4, -5], [3, 3, 2], 0xd7c99a, "antenna");
    }
    add(0, [0, 6.2, 0], [1, 1, 18], 0x234a63, "seam");
    add(6, [0, 0, 3], [3, 3, 3], 0xb7c498, "tail");
    for (let pi = 2; pi < 6; pi++)
      add(pi, [pi % 2 ? -1 : 1, -7, -1], [6, 2, 5], 0x668b84, "foot");
  }
  cache.set(type, pieces);
  return pieces;
}
export function visibleAnimalDetails(e, parts, fine = true) {
  return animalDetails(e.type, parts).filter(
    (d) =>
      !(e.lost & (1 << d.part)) &&
      (!e.damage[d.part] || e.damage[d.part][d.voxel] !== 0) &&
      (fine || !d.micro),
  );
}
export function rayArtBox(origin, direction, box, max) {
  let lo = 0,
    hi = max;
  for (let i = 0; i < 3; i++) {
    const min = box.at[i] - box.size[i] / 2,
      maxEdge = box.at[i] + box.size[i] / 2;
    if (Math.abs(direction[i]) < 1e-10) {
      if (origin[i] < min || origin[i] > maxEdge) return null;
      continue;
    }
    let a = (min - origin[i]) / direction[i],
      b = (maxEdge - origin[i]) / direction[i];
    if (a > b) [a, b] = [b, a];
    lo = Math.max(lo, a);
    hi = Math.min(hi, b);
    if (lo > hi) return null;
  }
  return hi >= 0.01 && lo < max ? Math.max(0.01, lo) : null;
}
